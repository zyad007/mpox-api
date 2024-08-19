const openai = require('openai');
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser');
const { finished } = require('stream/promises');
const { Readable } = require('stream');
const path = require('path')
const dotenv = require('dotenv')
dotenv.config()


let MPOX_DATA = undefined;

try {
    MPOX_DATA = JSON.parse(fs.readFileSync('./dist/data.json').toString())
}
catch (e) {

}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const client = new openai.OpenAI({
    apiKey: OPENAI_API_KEY
});

async function getCountryCode(country) {
    try {
        const response = await client.chat.completions.create({
            messages: [{ role: 'user', content: `What is the country code for ${country}? Respond only with the country code of 2 characaters` }],
            model: 'gpt-3.5-turbo',

        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error sending prompt to OpenAI:', error.response ? error.response.data : error.message);
    }
}

function loadCenterData() {
    const countryCenter = fs.readFileSync('./data/countries-center.csv').toString();

    const countryCenterMap = new Map();

    countryCenter.split('\r\n')
        .map(x => {
            const data = x.split(',')
            const key = data.shift();
            data.pop();
            const value = data.join(',');
            return {
                key,
                value
            }
        })
        .forEach(x => {
            countryCenterMap.set(x.key, x.value)
        })

    return countryCenterMap
}

const app = express();
const port = 3000

app.use(cors())

app.use(express.static(path.join(__dirname, 'dist'))); //  "public" off of current is root


app.get('/update', async (req, res) => {

    const stream = fs.createWriteStream('./data/MPX-Cases-Deaths-by-Country.csv');
    const { body } = await fetch('https://www.cdc.gov/poxvirus/mpox/data/MPX-Cases-Deaths-by-Country.csv')
    await finished(Readable.fromWeb(body).pipe(stream))

    const arr = [];

    const countryCenterMap = loadCenterData()


    const mpoxData = fs.readFileSync('./data/MPX-Cases-Deaths-by-Country.csv').toString();

    const data = mpoxData.split('\n').map(x => x.split(','));

    // console.log(data[0]);

    const header = data.shift()
    const countryIndex = (header.findIndex(x => x === 'Country'));
    const casesIndex = (header.findIndex(x => x === 'Cases'));
    const deathsIndex = (header.findIndex(x => x === 'Deaths'));

    console.log(header);

    for (let i = 0; i < data.length; i++) {
        const country = data[i][countryIndex]
        const countryCode = await getCountryCode(data[i][countryIndex]);
        const cases = data[i][casesIndex]
        const deaths = data[i][deathsIndex]
        const location = countryCenterMap.get(countryCode)
        console.log(location);

        arr.push({
            country,
            countryCode,
            cases,
            deaths,
            location
        })
    }
    console.log(arr);

    fs.writeFileSync('./dist/data.json', JSON.stringify(arr))

    MPOX_DATA = arr;

    return res.send(arr)

})


app.get('/', async (req, res) => {
    try {

        if (MPOX_DATA && MPOX_DATA.length) {
            return res.send(MPOX_DATA)
        }

        MPOX_DATA = JSON.parse(fs.readFileSync('./dist/data.json').toString())

        return res.send(MPOX_DATA)
    }
    catch (e) {
        console.log(e);
    }
})

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
})