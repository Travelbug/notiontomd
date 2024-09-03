#!/usr/bin/env node

const { Client } = require('@notionhq/client');
const fs = require('fs-extra')
const path = require('path');
const slug = require('slug')

const configPath = path.join(__dirname, '..', 'config.js');
let config;
let relationshipWords = 0;
let characterBackgroundWords = 0;
let characterPlaystyleWords = 0;
let characterBeliefWords = 0;
let totalWords = 0;

if(fs.existsSync(configPath)){
    config = require(configPath);
}else{
    config = {
        NOTION_API_KEY: process.env.NOTION_API_KEY,
        CHARACTER_DATABASE_ID: process.env.CHARACTER_DATABASE_ID,
        GROUP_DATABASE_ID: process.env.GROUP_DATABASE_ID,
        POSITION_DATABASE_ID: process.env.POSITION_DATABASE_ID,
        RELATION_DATABASE_ID: process.env.RELATION_DATABASE_ID,
        CASTING_DATABASE_ID: process.env.CASTING_DATABASE_ID,
        GLOSSARY_DATABASE_ID: process.env.GLOSSARY_DATABASE_ID,
        EXPORT_PATH: process.env.EXPORT_PATH,
        RELATIONS_PATH: process.env.RELATIONS_PATH,
        BASE_URL: process.env.BASE_URL,
        MONGODB_URL: process.env.MONGODB_URL,
    };
}

const notion = new Client({ auth: config.NOTION_API_KEY });
let characterPages = [];
let groupPages = [];
let positionPages = [];
let relationPages = [];
let castingPages = [];
let characters = [];
let glossaryPages = [];

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

function renderGlossary() {
    
    fs.outputFileSync(config.GLOSSARY_PATH + 'glossary.md', 
        '---\n' +
        'title: In-Game Glossary\n' +
        'weight: 10\n' +
        '---\n\n' +
        `To be able to play the game responsibly but also somewhat historically accurate, we decided that we will create a glossary for us and our players. The glossary contains all the problematic and derogatory in-game words and phrases we are going to use during play. We will not tolerate any other violent terms. It also explains why they are problematic and give a suggestion for an alternative use off-game and during calibration.  \n\n`+
        `###### We won't use those terms off-game  \n\n`+
        `That way, we want to increase awareness while not falling into the trap of just ignoring this problematic part of our history by replacing it with fantasy language or avoiding it. If anyone does not want to play with any of the words on this glossary, please contact us. We will consider adjustments and advice from players, especially if someone is directly affected by discrimination factors we’re playing on.  \n\n` +
        'We know this is a difficult part to get right. Our hope is, that by creating this glossary, we will encourage everyone to read into these topics.  \n\n'
    );
    let categories = {};
    glossaryPages.forEach(page => {
        let ingame = page.properties['In-Game'].title[0]?.plain_text ?? '';
        let offgame = page.properties['Off-Game']?.rich_text ?? [];
        offgame = renderRichTextToMarkdown(offgame);
        offgame = wrapParagraphsInMarkdown(offgame);
        let context = page.properties['Context']?.rich_text ?? [];
        context = renderRichTextToMarkdown(context);
        context = wrapParagraphsInMarkdown(context);
        let category = page.properties['Category'].select?.name ?? '';
        
        if(!(category in categories))
            categories[category] = [];
        categories[category].push({ingame, offgame, context, category});
    });
    
    let entries = Object.entries(categories);
    // Sort entries alphabetically by the category
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    categories = Object.fromEntries(entries);

    // Sort entries alphabetically by the ingame property
    for (const category in categories) {
        categories[category].sort((a, b) => a.ingame.localeCompare(b.ingame));
    }
    
    for (const [category, entries] of Object.entries(categories)) {
        fs.appendFileSync(config.GLOSSARY_PATH + 'glossary.md', 
            `### ${category}\n\n---\n`
        );
        
        entries.forEach(entry => {
            fs.appendFileSync(config.GLOSSARY_PATH + 'glossary.md', 
                `<a id="`+slug(entry.ingame)+`"></a>\n` +
                `- **${entry.ingame}**\n` +
                (entry.offgame !== '' ? `- Non-Derogatory / Off-Game: \n\n  ${entry.offgame}\n` : '')+
                `- Context: \n\n  ${entry.context}  \n---\n`
            );
        });
    }
}

let totalGlossaryReplacements = {};
let glossaryEntries = [];
function initializeGlossaryReplacements() {
    glossaryEntries = glossaryPages.map(page => page.properties['In-Game'].title[0]?.plain_text);
    glossaryEntries = glossaryEntries.filter(entry => entry !== undefined);
    glossaryEntries = glossaryEntries.sort((a, b) => b.length - a.length); // Sort by length in descending order
    //glossaryEntries = glossaryEntries.map(entry => entry.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')); // Escape special characters

    glossaryEntries.forEach(entry => {
        totalGlossaryReplacements[entry] = 0;
    });
    
}

function wrapTextWithGlossaryLinks(text) {
    glossaryEntries.forEach((entry, index) => {
        //split entry by / and add each part to the glossary
        let parts = entry.split('/');
        parts.forEach(part => {
            if(part === '')
                return;
            part = part.trim();
            part.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            let count = 0;

            //replace regular
            let regex = new RegExp(`(?<!\\[)\\b(${part}s?)\\b`, 'gi');
            text = text.replace(regex, (match) => {
                count++;
                return `${match}<sup>[${index + 1}](/awareness/#${slug(entry)})</sup>`;
            });
            
            //replace /glossary[entry] with sup number link
            regex = new RegExp(`/glossary\\[${part}\\]`, 'gi');
            text = text.replace(regex, (match) => {
                count++;
                return `<sup>[${index + 1}](/awareness/#${slug(entry)})</sup>`;
            });
            
            totalGlossaryReplacements[entry] += count;
        });
    });

    return text;
}

function renderRichTextToMarkdown(richText) {
    if (!richText) return '';

    return richText.map(textElement => {
        let text = textElement.plain_text;

        if (textElement.annotations.bold) {
            text = `**${text}**`;
        }
        if (textElement.annotations.italic) {
            text = `*${text}*`;
        }
        if (textElement.annotations.strikethrough) {
            text = `~~${text}~~`;
        }
        if (textElement.annotations.underline) {
            text = `__${text}__`;
        }
        if (textElement.annotations.code) {
            text = `\`${text}\``;
        }

        return text;
    }).join('');
}

function wrapParagraphsInMarkdown(text) {
    // Split the text into paragraphs
    let paragraphs = text.split('\n\n');

    // Wrap each paragraph in <p> tags
    //paragraphs = paragraphs.map(paragraph => `\n\n  ${paragraph}`);

    // Join the paragraphs back into a single string
    paragraphs = paragraphs.join('\n\n  ');

    paragraphs = paragraphs.split('\n');
    //paragraphs = paragraphs.map(paragraph => `  \n${paragraph}`);
    return paragraphs.join('  \n');
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
    relationships = undefined;
    supports = [];
    opposes = [];
    
    beliefDescription = "";
    playstyleDescription = "";
    backgroundDescription = "";
    
    sections = [];
    currentSection;
    
    constructor(pageId, name, coreBelief, id, title, age, nationality, gender, group, position, relationships, supports, opposes){
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
        this.relationships = relationships;
        this.supports = supports;
        this.opposes = opposes;
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
    
    renderRelationships() {
        let output = '';
        for (let key in this.relationships) {
            if (!this.relationships.hasOwnProperty(key)) 
                continue;
            
            let relation = this.relationships[key];
            
            if(
                (relation.activeDescription === undefined || relation.activeDescription === '') && 
                (relation.passiveDescription === undefined || relation.passiveDescription === ''))
                continue;
            
            output += `- **${key}**  `;
            output += `(${relation.age}, ${relation.position}, ${relation.group}, ${relation.nationality})  \n`;
            if(relation.activeDescription !== undefined && relation.activeDescription !== '')
                output += `${relation.activeDescription}  \n`;
            if(relation.passiveDescription !== undefined && relation.passiveDescription !== '')
                output += `${relation.passiveDescription}  \n`;
        }
        output = wrapTextWithGlossaryLinks(output);
        return output
    }
    
    renderBigotries() {
        let output = '';
        if(this.supports.length > 0){
            output += '### Supports\n\n';
            output += '###### ' + this.supports.join(', ') + '\n\n';
        }
        if(this.opposes.length > 0){
            output += '### Opposes\n\n';
            output += '###### ' + this.opposes.join(', ') + '\n\n';
        }
        return output;
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
        this.backgroundDescription = joinNestedArrays(this.sections[3]);

        characterBeliefWords += countWords(this.beliefDescription);
        characterPlaystyleWords += countWords(this.playstyleDescription);
        characterBackgroundWords += countWords(this.backgroundDescription);
        
        // Wrap glossary links in the descriptions
        this.beliefDescription = wrapTextWithGlossaryLinks(this.beliefDescription);
        this.playstyleDescription = wrapTextWithGlossaryLinks(this.playstyleDescription);
        this.backgroundDescription = wrapTextWithGlossaryLinks(this.backgroundDescription);
        
        //console.log(this.beliefDescription);
        //console.log('Rendering ' + this.name);
        //console.log('Belief: ' + countWords(this.beliefDescription) + ' words');
        //console.log('Playstyle: ' + countWords(this.playstyleDescription) + ' words');
        /*if(totalWords > 300 || totalWords < 200){
            console.error('Total: ' + (countWords(this.beliefDescription) + countWords(this.playstyleDescription)) + ' words');
        }else{
            console.log('Total: ' + (countWords(this.beliefDescription) + countWords(this.playstyleDescription)) + ' words');
        }*/
        //console.log('---');
        
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
            `- **Expectation:** ${this.position.expectation}\n\n` +
            '---\n' +
            '## Background\n\n' +
            this.backgroundDescription + '\n\n' +
            '---\n' +
            '## Relationships\n\n' +
            this.renderRelationships() + '\n\n' +
            '---\n' +
            this.renderBigotries()
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

function createRelationshipsForCharacter(characterPage, relationPages) {
    let relationships = [];
    relationPages.forEach(relationPage => {
        if(relationPage.properties['From'].relation[0]?.id === characterPage.id){
            let toCharacter = getPageFromId(relationPage.properties['Towards'].relation[0]?.id, characterPages);
            let characterName = composeCharacterName(toCharacter);
            addRelationshipCharacterProperties(characterName, toCharacter);
            addOrUpdateProperty(characterName, 'activeDescription', relationPage.properties['Active Relationship Description'].rich_text[0]?.plain_text.trim() ?? '');
            addOrUpdateProperty(characterName, 'priority', relationPage.properties['From Priority'].number ?? 10);
            relationshipWords += countWords(relationPage.properties['Active Relationship Description'].rich_text[0]?.plain_text.trim() ?? '');
        }
        if(relationPage.properties['Towards'].relation[0]?.id === characterPage.id){
            let fromCharacter = getPageFromId(relationPage.properties['From'].relation[0]?.id, characterPages);
            let characterName = composeCharacterName(fromCharacter);
            addRelationshipCharacterProperties(characterName, fromCharacter);
            addOrUpdateProperty(characterName, 'priority', relationPage.properties['Towards Priority'].number ?? 10);
            addOrUpdateProperty(characterName, 'passiveDescription', relationPage.properties['Passive Relationship Description'].rich_text[0]?.plain_text.trim() ?? '');
            relationshipWords += countWords(relationPage.properties['Passive Relationship Description'].rich_text[0]?.plain_text.trim() ?? '');
        }
    });
    
    let entries = Object.entries(relationships);
    entries.sort((a, b) => {
        if(a[1].priority < b[1].priority) return -1;
        /*if(a[1].activeDescription === undefined && b[1].activeDescription !== undefined) {
            return 1;
        }else if(a[1].activeDescription !== undefined && b[1].activeDescription === undefined){
            return -1;
        }else{
            return 0;
        }*/
    });
    relationships = Object.fromEntries(entries);
    
    return relationships;
    
    function addOrUpdateProperty(key, property, value){
        if(!(key in relationships))
            relationships[key] = {};
        relationships[key][property] = value;
    }
    
    function addRelationshipCharacterProperties(characterName, characterPage){
        let group = getPageFromId(characterPage.properties['Group'].relation[0]?.id, groupPages);
        let position = getPageFromId(characterPage.properties['Position'].relation[0]?.id, positionPages);
        let age = characterPage.properties['Age'].rich_text[0]?.plain_text;
        let nationality = characterPage.properties['Nationality'].rich_text[0]?.plain_text;
        addOrUpdateProperty(characterName, 'age', age);
        addOrUpdateProperty(characterName, 'nationality', nationality);
        addOrUpdateProperty(characterName, 'group', group.properties.Name.title[0]?.plain_text);
        addOrUpdateProperty(characterName, 'position', position.properties.Name.title[0]?.plain_text);
    }
    
    function composeCharacterName(character) {
        let title = character.properties['Title'].rich_text[0]?.plain_text ?? '';
        let name = character.properties.Name.title[0]?.plain_text;
        
        if(title === '') {
            return name;
        }else{
            return title + ' ' + name;
        }
    }
}

function createMarkdown() {
    fetchNotionData().then(() => {
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
                createRoleFromPage(position),
                createRelationshipsForCharacter(page, relationPages),
                page.properties['Supports'].multi_select.map(support => support.name),
                page.properties['Opposes'].multi_select.map(oppose => oppose.name)
            );
            characters.push(characterRenderer);
        })).then(() => {
            console.log('Rendering all characters');
            renderAllCharacters();
            updateWebLinks();
            
            console.log(`Total words: ${relationshipWords + characterBeliefWords + characterPlaystyleWords + characterBackgroundWords}`);
            console.log(`Total character belief words: ${characterBeliefWords}`);
            console.log(`Total character playstyle words: ${characterPlaystyleWords}`);
            console.log(`Total character background words: ${characterBackgroundWords}`);
            console.log(`Total relationship words: ${relationshipWords}`);

            Object.entries(totalGlossaryReplacements).forEach(([entry, count]) => {
                console.log(`${entry}: ${count}`);
            });
            
            wait(5000).then(() => {
                // Test character rendering for the first character
                var character = characters.find(character => character.id === 1);
                generatePDFForCharacter(character);
            });
        }).then(() => {
            console.log('Rendering glossary');
            renderGlossary();
        });
    }).catch(err => console.error(err));
}

function fetchNotionData() {
    return new Promise((resolve, reject) => {
        Promise.all([
            getDatabasePages(config.CHARACTER_DATABASE_ID),
            getDatabasePages(config.RELATION_DATABASE_ID),
            getDatabasePages(config.GROUP_DATABASE_ID),
            getDatabasePages(config.CASTING_DATABASE_ID),
            getDatabasePages(config.POSITION_DATABASE_ID),
            getDatabasePages(config.GLOSSARY_DATABASE_ID)
        ]).then(values => {
            characterPages = values[0];
            relationPages = values[1];
            groupPages = values[2];
            castingPages = values[3];
            positionPages = values[4];
            glossaryPages = values[5];
            initializeGlossaryReplacements();
            resolve();
        }).catch(err=>{
            console.error(err);
            reject(err);
        });
    });
}

function createRelationJSON(characterPages, relationPages) {
    let nodedataArray = [];
    let linkDataArray = [];

    characterPages.forEach(characterPage => {
        let name = (characterPage.properties.Title.rich_text[0]?.plain_text ?? '') + ' ' + characterPage.properties.Name.title[0]?.plain_text;
        nodedataArray.push({
            id: characterPage.id,
            text: name.trim(),
            belief: characterPage.properties['Core Belief'].rich_text[0]?.plain_text,
            group: getPageFromId(characterPage.properties['Group'].relation[0]?.id,groupPages)?.properties.Name.title[0]?.plain_text,
            nationality: characterPage.properties.Nationality.rich_text[0]?.plain_text,
            pageUrl: characterPage.url
        });
    });

    nodedataArray.sort((a, b) => {
        if (a.group < b.group) return -1;
        if (a.group > b.group) return 1;
        return 0;
    });

    relationPages.forEach(relationPage => {
        linkDataArray.push({
            from: relationPage.properties['From'].relation[0]?.id,
            to: relationPage.properties['Towards'].relation[0]?.id,
            text: relationPage.properties['Active Relationship Description'].rich_text[0]?.plain_text ?? '',
            type: 'relation',
            length: 50,
            pageUrl: relationPage.url
        });
    });

    //flags
    castingPages.forEach(castingPage => {
        castingPage.properties[ 'Flags Negatively' ].relation.forEach(flag => {
            let flaggedCharacter = getPageFromId(flag.id, castingPages).properties[ 'Character' ].relation[0]?.id;
            let flaggingCharacter = castingPage.properties[ 'Character' ].relation[0]?.id;
            linkDataArray.push({
                from: flaggingCharacter,
                to: flaggedCharacter,
                text: '',
                type: 'flag',
                length: 400,
            });
        });
    });

    //wishes
    castingPages.forEach(castingPage => {
        castingPage.properties[ 'Flags Positively' ].relation.forEach(wish => {

            //only counts if also flagged positively by the other character
            let wishedPage = getPageFromId(wish.id, castingPages);
            if(wishedPage.properties[ 'Flags Positively' ].relation.find(wish => wish.id === castingPage.id) === undefined)
                return;

            let wishedCharacter = wishedPage.properties[ 'Character' ].relation[0]?.id;
            let wishingCharacter = castingPage.properties[ 'Character' ].relation[0]?.id;

            //only add the relation if it doesn't already exist
            if(linkDataArray.find(link => link.from === wishingCharacter && link.to === wishedCharacter || link.from === wishedCharacter && link.to === wishingCharacter) !== undefined)
                return;

            linkDataArray.push({
                from: wishingCharacter,
                to: wishedCharacter,
                text: '',
                type: 'wish',
                length: 200,
            });
        });
    });
    
    return '' +        
    '{ "class": "go.GraphLinksModel",\n' +
    '  "nodeKeyProperty": "id",\n' +
    '  "nodeDataArray": ' + JSON.stringify(nodedataArray) + ',\n' +
    '  "linkDataArray": ' + JSON.stringify(linkDataArray) + '\n' +
    '}'
}

function createSuperiorityJSON(characterPages, relationPages) {
    let nodedataArray = [];
    let linkDataArray = [];

    characterPages.forEach(characterPage => {
        let name = (characterPage.properties.Title.rich_text[0]?.plain_text ?? '') + ' ' + characterPage.properties.Name.title[0]?.plain_text;
        nodedataArray.push({
            id: characterPage.id,
            text: name.trim(),
            position: getPageFromId(characterPage.properties['Position'].relation[0]?.id,positionPages)?.properties.Name.title[0]?.plain_text,
            group: getPageFromId(characterPage.properties['Group'].relation[0]?.id,groupPages)?.properties.Name.title[0]?.plain_text,
            nationality: characterPage.properties.Nationality.rich_text[0]?.plain_text,
            pageUrl: characterPage.url
        });
        
        characterPage.properties['Subordinates'].relation.forEach(subordinate => {
            linkDataArray.push({
                from: characterPage.id,
                to: subordinate.id,
                no: characterPage.properties['ID'].number,
                text: '',
                type: 'subordinate',
                length: 50,
            });
            console.log('Subordinate: ' + subordinate.id);
        });
        
    });
    
    
    return '' +
    '{ "class": "go.GraphLinksModel",\n' +
    '  "nodeKeyProperty": "id",\n' +
    '  "nodeDataArray": ' + JSON.stringify(nodedataArray) + ',\n' +
    '  "linkDataArray": ' + JSON.stringify(linkDataArray) + '\n' +
    '}'
}

function writeRelations(characterPages, relationPages) {
    fetchNotionData().then(() => {
        let json = createRelationJSON(characterPages, relationPages);
        fs.outputFileSync(config.RELATIONS_PATH + 'relations.json', json);
    });
}

const { MongoClient } = require('mongodb');
const client = new MongoClient(config.MONGODB_URL);
const collectionName = 'positions';
async function savePositionsToMongoDB(nodeData) {
    try {
        await client.connect();
        console.log('Connected successfully to MongoDB server');
        const db = client.db();
        const collection = db.collection(collectionName);

        for (const node of nodeData) {
            const filter = { key: node.key }; // Use the "key" property as the filter
            const update = { $set: node }; // Set the document to the node data
            const options = { upsert: true }; // Enable upsert option

            // Perform the upsert operation
            const result = await collection.updateOne(filter, update, options);
            console.log(`Upserted document with key ${node.key}: matched ${result.matchedCount}, modified ${result.modifiedCount}, upsertedId ${result.upsertedId}`);
        }
        
    } catch (err) {
        console.error('Failed to save positions to MongoDB:', err);
    } finally {
        await client.close();
    }
}

async function fetchPositionsFromMongoDB() {
    try {
        await client.connect();
        console.log('Connected successfully to MongoDB server');
        const db = client.db();
        const collection = db.collection(collectionName);

        // Fetch all documents in the collection
        const positions = await collection.find({}).toArray();
        console.log('Positions fetched successfully');

        return positions; // Return the fetched positions
    } catch (err) {
        console.error('Failed to fetch positions from MongoDB:', err);
        return []; // Return an empty array in case of error
    } finally {
        await client.close();
    }
}

// Use port number from the PORT environment variable or 3000 if not specified
const port = process.env.PORT || 3000;
const express = require('express');
const app = express();

const publicDirectoryPath = path.join(__dirname, 'public');

app.use(express.static(publicDirectoryPath));
app.get('/relations', (req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    fetchNotionData().then(() => {
        let json = createRelationJSON(characterPages, relationPages);
        res.end(json);
        console.log('Serving json ' + json);
    });
});

app.get('/superiority', (req, res)=> {
    res.writeHead(200, {'Content-Type': 'application/json'});
    fetchNotionData().then(() => {
        let json = createSuperiorityJSON(characterPages, relationPages);
        res.end(json);
        console.log('Serving json ' + json);
    });
});

app.get('/chainofcommand', (req, res)=>{
    res.sendFile(path.join(publicDirectoryPath, 'chainofcommand.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDirectoryPath, 'chainofcommand.html'));
});

app.use(express.json());
app.get('/positions', (req, res) => {
    fetchPositionsFromMongoDB()
        .then(positions => {
            res.status(200).json(positions);
        })
        .catch(error => {
            console.error(error);
            res.status(500).send('Error fetching positions from MongoDB');
        });
});
app.post('/savePositions', (req, res) => {
    const nodeData = req.body;
    try {
        savePositionsToMongoDB(nodeData);
        res.status(200).send('Positions saved to MongoDB successfully');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error saving positions to MongoDB');
    }
});
function startServer() {
    /*server = http.createServer(listener);
    server.listen(port);
    console.log('Server running at http://127.0.0.1:3000/');*/
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}/`);
    });
}


/////////////////////////////

const args = process.argv.slice(2);  // Remove the first two elements
if (args.length > 0) {
    switch (args[0]) {
        case 'markdown':
            createMarkdown();
            break;
        case 'relations':
            fetchNotionData();
            break;
        default:
            console.log(`Unknown function: ${args[0]}`);
            break;
    }
} else {
    startServer()
}