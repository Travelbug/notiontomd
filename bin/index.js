#!/usr/bin/env node

const { Client } = require('@notionhq/client');
const fs = require('fs-extra')
const config = require('../config.js');
const slug = require('slug')

const notion = new Client({ auth: config.NOTION_API_KEY });
const characterPages = [];
const groupPages = [];
const positionPages = [];
const characters = [];

const puppeteer = require('puppeteer');

async function generatePDF(url, outputPath) {
    const browser = await puppeteer.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"});
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle0'});
    await page.$eval('.navbar', el => el.remove());
    await page.addStyleTag({content: 'body{background: none}'})
    await page.emulateMediaType('screen');
    await page.pdf({ path: outputPath, width:1000, height: 1357, printBackground: true, margin: { top: '1cm', bottom: '1cm' }});
    await browser.close();
}

function generatePDFForCharacter(character) {
    console.log('Generating PDF for ' + character.name);
    generatePDF('http://localhost:1313/characters/' + character.renderPath, config.EXPORT_PATH + character.renderPath + '.pdf')
        .then(() => console.log('PDF generated successfully'))
        .catch(err => console.error('Error generating PDF:', err));
}

async function getDatabasePages(databaseId) {
    let cursor = undefined;
    let pages = [];

    while (true) {
        const response = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
        });

        pages = [...pages, ...response.results];

        if (!response.has_more) {
            break;
        }

        cursor = response.next_cursor;
    }

    return pages;
}

async function getPageContent(pageId) {
    const response = await notion.blocks.children.list({ block_id: pageId });
    return response;
}

function renderAllCharacters() {
    characters.forEach(character => {
        character.renderCharacter();
    });
}

function updateWebLinks() {
    characters.forEach(character => {
        notion.pages.update({
            page_id: character.pageId,
            properties: {
                'Weblink': {
                    type: 'url',
                    url: character.weblink
                }
            }
        }).catch(err => console.error('Error updating weblink:', err));
    });
}

function getPageFromId(pageId, pages) {
    return pages.find(page => page.id === pageId);
}

class CharacterRenderer{
    pageId = "";
    name = "";
    coreBelief = "";
    id = 0;
    title = "";
    age = "";
    nationality = "";
    gender = "";
    group = undefined;
    position = undefined;
    renderPath = "";
    weblink = "";
    
    beliefDescription = "";
    playstyleDescription = "";
    
    sections = [];
    currentSection;
    
    constructor(pageId, name, coreBelief, id, title, age, nationality, gender, group, position){
        this.pageId = pageId;
        this.name = name;
        this.coreBelief = coreBelief;
        this.id = id;
        this.title = title;
        this.age = age;
        this.nationality = nationality;
        this.gender = gender;
        this.group = group;
        this.position = position;
        this.renderPath = slug(this.group.name) + '/' + slug(this.name);
        this.weblink = config.BASE_URL + this.renderPath;
        return this.readPageContent();
    }
    async readPageContent() {
        const content = await getPageContent(this.pageId);
        //console.log('Reading ' + this.name);
        content.results.forEach(block => {
            //console.log('..Block ' + block.type);
            this.processPageBlock(block);
        });
        return this;
    }
    processPageBlock(block) {
        switch (block.type) {
            case 'heading_1':
                this.sections.push([]);
                this.currentSection = this.sections[this.sections.length - 1];
                break;
            case 'heading_2':
                let heading1 = this.sections[this.sections.length - 1];
                heading1.push([]);
                this.currentSection = heading1[heading1.length-1];
                break;
            case 'paragraph':
                this.processPageParagraph(block.paragraph);
                break;
            case 'bulleted_list_item':
                this.processPageParagraph(block.bulleted_list_item);
                break;
        }
    }
    
    processPageParagraph(text) {

        if(text.color && text.color === 'gray_background')
            return;
        
        if(text.rich_text === undefined){
            console.log('rich_text is undefined');
            console.log(this.name + ' ' + this.currentSection);
            console.log(text);
            return;
        }
        
        var plaintext = '';
        
        text.rich_text.forEach(richtext => {
            if(richtext === undefined){
                console.log('richtext is undefined');
                console.log(this.name + ' ' + this.currentSection);
                console.log(text);
                return;
            }
            
            if(richtext.annotations === undefined){
                console.log('annotations is undefined');
                console.log(this.name + ' ' + this.currentSection);
                console.log(richtext);
                return;
            }
            
            if(richtext.annotations.color === 'gray')
                return;
            if(richtext.color && richtext.color === 'gray_background')
                return;
            
            plaintext += richtext.plain_text;
        });
        
        if(plaintext === '')
            return;

        if(plaintext === '\n')
            return;
        
        if(plaintext.startsWith('Belief:'))
            return;
        
        if(this.currentSection === undefined)
            return;
        
        this.currentSection.push(plaintext);
    }
    
    renderCharacter() {
        // Add headings to play style sections
        addHeadings(this.sections[1], [
            '###### What you will do during the game\n',
            '###### What will you struggle with\n',
            '###### What will help you\n',
        ]);
        
        // Join all the sections into a single string
        this.beliefDescription = joinNestedArrays(this.sections[0], '-', '\n');
        this.playstyleDescription = joinNestedArrays(this.sections[1]);
        
        let beliefWords = countWords(this.beliefDescription);
        let playstyleWords = countWords(this.playstyleDescription);
        let totalWords = beliefWords + playstyleWords;
        //console.log(this.beliefDescription);
        console.log('Rendering ' + this.name);
        //console.log('Belief: ' + countWords(this.beliefDescription) + ' words');
        //console.log('Playstyle: ' + countWords(this.playstyleDescription) + ' words');
        if(totalWords > 300 || totalWords < 200){
            console.error('Total: ' + (countWords(this.beliefDescription) + countWords(this.playstyleDescription)) + ' words');
        }else{
            console.log('Total: ' + (countWords(this.beliefDescription) + countWords(this.playstyleDescription)) + ' words');
        }
        console.log('---');
        
        fs.outputFileSync(config.EXPORT_PATH + this.renderPath + '.md',
            '---\n' +
            `title: ${this.title} ${this.name}\n` +
            'weight: '+this.id+'\n' +
            'group: '+this.group.name+'\n' +
            'position: '+this.position.name+'\n' +
            '_build: \n' +
            '  list: always \n' +
            '---\n' +
            `### ${this.group.name}, ${this.position.name}\n\n` +
            `###### ${this.age} years, ${this.nationality}, ${this.gender}\n\n` +
            '---\n' +
            '## Core Belief\n\n' +
            /*'> ' + this.coreBelief + '\n' +
            '> # ' + this.name + '\n\n' +*/
            `#### ${this.coreBelief} \n` +
            this.beliefDescription + '\n\n' +
            '---\n' +
            '## Play Style\n\n' +
            this.playstyleDescription + '\n\n' +
            '---\n' +
            '## Roles\n\n' +
            `###### ${this.group.name}\n` +
            `- **Obligation:** ${this.group.obligation}\n` +
            `- **Rights:** ${this.group.rights}\n` +
            `- **Expectation:** ${this.group.expectation}\n\n` +
            `###### ${this.position.name}\n` +
            `- **Obligation:** ${this.position.obligation}\n` +
            `- **Rights:** ${this.position.rights}\n` +
            `- **Expectation:** ${this.position.expectation}\n\n`
        );
    }
}

function countWords(str) {
    return str.trim().split(/\s+/).length;
}

function addHeadings(section, headings) {
    section.forEach((element, i) => {
        if (Array.isArray(element)) {
            element.unshift(headings[i]);
        } 
    });
}

function joinNestedArrays(arr, before = '', after = '\n\n') {
    let result = '';

    arr.forEach(element => {
        if (Array.isArray(element)) {
            result += joinNestedArrays(element);
        } else if (typeof element === 'string') {
            result += `${before} ${element}${after}`;
        }
    });

    return result;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createRoleFromPage(rolePage){
    return {
        id: rolePage.id,
        name: rolePage.properties.Name.title[0]?.plain_text ?? '',
        obligation: rolePage.properties.Obligation.rich_text[0]?.plain_text ?? '',
        rights: rolePage.properties.Rights.rich_text[0]?.plain_text ?? '',
        expectation: rolePage.properties.Expectation.rich_text[0]?.plain_text ?? ''
    }
}

/////////////////////////////

getDatabasePages(config.CHARACTER_DATABASE_ID).then(pages =>{
    characterPages.push(...pages);
}).then(() => {
    getDatabasePages(config.GROUP_DATABASE_ID).then(pages => {
        groupPages.push(...pages);
    }).then(() => {
        getDatabasePages(config.POSITION_DATABASE_ID).then(pages => {
            positionPages.push(...pages);
        }).then(() => {
            Promise.all(characterPages.map(async page => {
                let group = getPageFromId(page.properties['Group'].relation[0]?.id, groupPages);
                let position = getPageFromId(page.properties['Position'].relation[0]?.id, positionPages);
                let characterRenderer = await new CharacterRenderer(
                    page.id,
                    page.properties.Name.title[0]?.plain_text ?? '',
                    page.properties['Core Belief'].rich_text[0]?.plain_text ?? '',
                    page.properties['ID'].number ?? 0,
                    page.properties['Title'].rich_text[0]?.plain_text ?? '',
                    page.properties['Age'].rich_text[0]?.plain_text ?? '',
                    page.properties['Nationality'].rich_text[0]?.plain_text ?? '',
                    page.properties['Gender'].rich_text[0]?.plain_text ?? '',
                    createRoleFromPage(group),
                    createRoleFromPage(position)
                );
                characters.push(characterRenderer);
            })).then(() => {
                console.log('Rendering all characters');
                renderAllCharacters();
                updateWebLinks();
                wait(5000).then(() => {
                    // Test character rendering for the first character
                    var character = characters.find(character => character.id === 1);
                    generatePDFForCharacter(character);
                });
            })
        })
    })
}).catch(err => console.error(err));