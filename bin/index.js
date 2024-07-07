#!/usr/bin/env node

const { Client } = require('@notionhq/client');
const fs = require('fs-extra')
const config = require('../config.js');
const slug = require('slug')

const notion = new Client({ auth: config.NOTION_API_KEY });
let characterPages = [];
let groupPages = [];
let positionPages = [];
let relationPages = [];
let castingPages = [];
let characters = [];

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

function createMarkdown() {
    getDatabasePages(config.CHARACTER_DATABASE_ID).then(pages => {
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
}

function fetchRelationsData() {
    return new Promise((resolve, reject) => {
        Promise.all([
            getDatabasePages(config.CHARACTER_DATABASE_ID),
            getDatabasePages(config.RELATION_DATABASE_ID),
            getDatabasePages(config.GROUP_DATABASE_ID),
            getDatabasePages(config.CASTING_DATABASE_ID)
        ]).then(values => {
            characterPages = values[0];
            relationPages = values[1];
            groupPages = values[2];
            castingPages = values[3];
            resolve();
        }).catch(err=>{
            console.error(err);
            reject(err);
        });
    });
    /*getDatabasePages(config.CHARACTER_DATABASE_ID).then(pages => {
        characterPages.push(...pages);
    }).then(() => {
        getDatabasePages(config.RELATION_DATABASE_ID).then(pages => {
            relationPages.push(...pages);
        }).then(() => {
            getDatabasePages(config.GROUP_DATABASE_ID).then(pages => {
                groupPages.push(...pages);
            }).then(()=>{
                getDatabasePages(config.CASTING_DATABASE_ID).then(pages => {
                    castingPages.push(...pages);
                }).then(() => {
                    writeRelations(characterPages, relationPages);
                })
            })
        })
    }).catch(err => console.error(err));*/
}

function createRelationJSON(characterPages, relationPages) {
    let nodedataArray = [];
    let linkDataArray = [];

    characterPages.forEach(characterPage => {
        nodedataArray.push({
            id: characterPage.id,
            text: characterPage.properties.Name.title[0]?.plain_text,
            belief: characterPage.properties['Core Belief'].rich_text[0]?.plain_text,
            group: getPageFromId(characterPage.properties['Group'].relation[0]?.id,groupPages)?.properties.Name.title[0]?.plain_text,
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

function writeRelations(characterPages, relationPages) {
    fetchRelationsData().then(() => {
        let json = createRelationJSON(characterPages, relationPages);
        fs.outputFileSync(config.RELATIONS_PATH + 'relations.json', json);
    });
    /*
    { "class": "go.GraphLinksModel",
  "nodeKeyProperty": "id",
  "nodeDataArray": [
    {"id":-1, "loc":"155 -150", "type":"Start", "text":"Start" },
    {"id":0, "loc":"190 15", "text":"Shopping"},
    {"id":1, "loc":"353 32", "text":"Browse Items"},
    {"id":2, "loc":"353 166", "text":"Search Items"},
    {"id":3, "loc":"552 12", "text":"View Item"},
    {"id":4, "loc":"700 -95", "text":"View Cart"},
    {"id":5, "loc":"660 100", "text":"Update Cart"},
    {"id":6, "loc":"850 20", "text":"Checkout"},
    {"id":-2, "loc":"830 200", "type":"End", "text":"End" }
  ],
  "linkDataArray": [
    { "from": -1, "to": 0, "progress": true, "text": "Visit online store", "curviness": -10 },
    { "from": 0, "to": 1,  "progress": true, "text": "Browse" },
    { "from": 0, "to": 2,  "progress": true, "text": "Use search bar", "curviness": -70 },
    { "from": 1, "to": 2,  "progress": true, "text": "Use search bar" },
    { "from": 2, "to": 3,  "progress": true, "text": "Click item", "curviness": -70 },
    { "from": 2, "to": 2,  "progress": false, "text": "Another search", "curviness": 40 },
    { "from": 1, "to": 3,  "progress": true, "text": "Click item" },
    { "from": 3, "to": 0,  "progress": false, "text": "Not interested", "curviness": -100 },
    { "from": 3, "to": 4,  "progress": true, "text": "Add to cart" },
    { "from": 4, "to": 0,  "progress": false, "text": "More shopping", "curviness": -150 },
    { "from": 4, "to": 5,  "progress": false, "text": "Update needed", "curviness": 70 },
    { "from": 5, "to": 4,  "progress": false, "text": "Update made" },
    { "from": 4, "to": 6,  "progress": true, "text": "Proceed" },
    { "from": 6, "to": 5,  "progress": false, "text": "Update needed"},
    { "from": 6, "to": -2, "progress": true, "text": "Purchase made" }
  ]
}
    */
}

// Use port number from the PORT environment variable or 3000 if not specified
const port = process.env.PORT || 3000;
const path = require('path');
const http = require('node:http');
var server;
const publicDirectoryPath = path.join(__dirname, 'public');

listener = function (request, response) {
    console.log('Request received for ' + request.url);
    
    if(request.url === '/relations'){
        response.writeHead(200, {'Content-Type': 'application/json'});
        fetchRelationsData().then(() => {
            let json = createRelationJSON(characterPages, relationPages);
            response.end(json);
            console.log('Serving json ' + json);
        });
        return;
    }
    
    let filePath = path.join(publicDirectoryPath, request.url);
    console.log('Serving file ' + filePath);
    fs.exists(filePath, (exists) => {
        if (!exists) {
            response.writeHead(404, {'Content-Type': 'text/html'});
            response.end('<h1>404 Not Found</h1>');
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                response.writeHead(500);
                response.end('Error loading file');
                return;
            }

            // Optional: Set Content-Type based on the file extension
            const ext = path.extname(filePath);
            let contentType = 'text/html'; // default to HTML
            switch (ext) {
                case '.json':
                    contentType = 'application/json';
                    break;
                // Add more cases for other content types as needed
            }

            response.writeHead(200, {'Content-Type': contentType});
            response.end(data);
        });
    });
};

function startServer() {
    server = http.createServer(listener);
    server.listen(port);
    console.log('Server running at http://127.0.0.1:3000/');
}


/////////////////////////////

const args = process.argv.slice(2);  // Remove the first two elements
if (args.length > 0) {
    switch (args[0]) {
        case 'markdown':
            createMarkdown();
            break;
        case 'relations':
            fetchRelationsData();
            break;
        default:
            console.log(`Unknown function: ${args[0]}`);
            break;
    }
} else {
    startServer()
}