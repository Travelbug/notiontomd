#!/usr/bin/env node

const { Client } = require('@notionhq/client');
const fs = require('fs-extra')
const config = require('../config.js');
const slug = require('slug')

const notion = new Client({ auth: config.NOTION_API_KEY });
const characters = [];
const ReadingModes = Object.freeze({
    None : 0,
    Belief : 1,
    Playstyle : 2,
    Done : 3
});

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

class CharacterRenderer{
    pageId = "";
    name = "";
    coreBelief = "";
    id = 0;
    
    beliefDescription = "";
    playstyleDescription = "";
    
    readingMode = ReadingModes.None;
    constructor(pageId, name, coreBelief, id){
        this.pageId = pageId;
        this.name = name;
        this.coreBelief = coreBelief;
        this.id = id;
        return this.readPageContent();
    }
    async readPageContent() {
        const content = await getPageContent(this.pageId);
        content.results.forEach(block => {
            if(this.readingMode === ReadingModes.Done) {
                return;
            }
            console.log("processing "+block.type);
            this.processPageBlock(block);
        });
        return this;
    }
    processPageBlock(block) {
        switch (block.type) {
            case 'heading_1':
                if(this.readingMode !== ReadingModes.Done)
                    this.readingMode++;
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
            console.log(this.name + ' ' + this.readingMode);
            console.log(text);
            return;
        }
        
        var plaintext = '';
        
        text.rich_text.forEach(richtext => {
            if(richtext === undefined){
                console.log('richtext is undefined');
                console.log(this.name + ' ' + this.readingMode);
                console.log(text);
                return;
            }
            
            if(richtext.annotations === undefined){
                console.log('annotations is undefined');
                console.log(this.name + ' ' + this.readingMode);
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
        
        switch (this.readingMode) {
            case ReadingModes.Belief:
                this.beliefDescription += plaintext;
                this.beliefDescription += '\n\n';
                break;
            case ReadingModes.Playstyle:
                this.playstyleDescription += plaintext;
                this.playstyleDescription += '\n\n';
                break;
        }
    }
    
    renderCharacter() {
        fs.outputFileSync(config.EXPORT_PATH + slug(this.name) + '.md',
            '---\n' +
            'title: '+this.name+'\n' +
            'weight: '+this.id+'\n' +
            '---\n' +
            '## ' + this.coreBelief + '\n\n' + 
            this.beliefDescription + '\n\n' + 
            '### Play Style\n\n' +
            this.playstyleDescription
        );
    }
}

getDatabasePages(config.DATABASE_ID
    .then(pages => Promise.all(pages.map(async page => {
        var characterRenderer = await new CharacterRenderer(
            page.id, 
            page.properties.Name.title[0]?.plain_text ?? '',
            page.properties['Core Belief'].rich_text[0]?.plain_text ?? '',
            page.properties['ID'].number ?? 0
            );
        characters.push(characterRenderer);
    }))).then(() => {
        console.log('Rendering all characters');
        renderAllCharacters();
    })
    .catch(err => console.error(err)));