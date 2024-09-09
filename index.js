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

const CSVLink = 'https://catalog.ourworldindata.org/explorers/who/latest/monkeypox/monkeypox.csv'
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
const countryCodesCache = {}
async function getCountryCode(country) {
    try {
        if (countryCodesCache[country]) return countryCodesCache[country]
        const response = await client.chat.completions.create({
            messages: [{ role: 'user', content: `What is the country code for ${country}? Respond only with the country code of 2 characaters` }],
            model: 'gpt-3.5-turbo',

        });
        countryCodesCache[country] = response.choices[0].message.content
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
const port = process.env.PORT | 3000

app.use(cors())

app.use(express.static(path.join(__dirname, 'dist'))); //  "public" off of current is root

app.get('/data', async (req, res) => {
    const data = fs.readFileSync('./dist/data.json')
    
    res.send(data)
})

app.get('/data-table', async (req, res) => {
    const data = fs.readFileSync('./dist/dataTable.json')
    
    res.send(data)
})

app.get('/update', async (req, res) => {

    const filteredArr = await update()

    return res.send(filteredArr)

})

async function update() {
    const stream = fs.createWriteStream('./data/MPX-Cases-Deaths-by-Country.csv');
    const { body } = await fetch(CSVLink)
    await finished(Readable.fromWeb(body).pipe(stream))

    const arr = [];

    const countryCenterMap = loadCenterData()


    const mpoxData = fs.readFileSync('./data/MPX-Cases-Deaths-by-Country.csv').toString();

    const data = mpoxData.split('\n').map(x => x.split(','));

    // console.log(data[0]);

    const header = data.shift()
    const countryIndex = (header.findIndex(x => x === 'location'));
    const casesIndex = (header.findIndex(x => x === 'total_cases'));
    const deathsIndex = (header.findIndex(x => x === 'total_deaths'));
    const newCasesIndex = (header.findIndex(x => x === 'new_cases'));
    const newDeathsIndex = (header.findIndex(x => x === 'new_deaths'));
    const dateIndex = (header.findIndex(x => x === 'date'));


    console.log(header);
    const countryCodes = {}
    for (let i = 0; i < data.length; i++) {
        const country = data[i][countryIndex]
        if (!countryCodes[country]) {
            const countryCode = await getCountryCode(data[i][countryIndex]);
            countryCodes[country] = countryCode
        }
        const cases = data[i][casesIndex]
        const deaths = data[i][deathsIndex]
        const location = countryCenterMap.get(countryCodes[country])
        const newCases = data[i][newCasesIndex]
        const newDeaths = data[i][newDeathsIndex]
        const date = data[i][dateIndex]
        console.log(location);
        if (!location) continue
        arr.push({
            country,
            countryCode: countryCodes[country],
            cases,
            deaths,
            location,
            newCases,
            newDeaths,
            date

        })
    }
    console.log(arr);
    fs.writeFileSync('./dist/dataTable.json', JSON.stringify(
        arr.filter(x => x.newCases != 0 
                        && !x.country.includes('Africa') 
                        && !x.country.includes('North America') 
                        && !x.country.includes('South America') 
                        && !x.country.includes('Africa')
                        && !x.country.includes('Europe')
                        && !x.country.includes('Asia')
                    )
                    .sort((a, b) => new Date(b.date) - new Date(a.date))
                )
            );
    const filteredArr = filterData(arr)
    fs.writeFileSync('./dist/data.json', JSON.stringify(filteredArr))
    // console.log(filteredArr);

    MPOX_DATA = filteredArr;

    return filteredArr
}
function filterData(arr) {
    const countries = {}
    for (let record of arr) {
        if (!countries[record.country]) {
            countries[record.country] = []
        }
        countries[record.country].push(record)
    }
    let countriesSummaries = []
    for (let country of Object.keys(countries)) {
        const startYear = new Date(countries[country][0].date).getFullYear()
        const currentYear = new Date().getFullYear()
        const totalCases = countries[country][countries[country].length - 1].cases
        const totalDeaths = countries[country][countries[country].length - 1].deaths
        const countrySummary = {
            country: countries[country][0].country,
            countryCode: countries[country][0].countryCode,
            cases: totalCases,
            deaths: totalDeaths,
            location: countries[country][0].location,
            date: countries[country][0].date
        }
        for (let year = startYear; year <= currentYear; year++) {
            let cases = 0
            let deaths = 0
            countries[country].forEach((record) => {
                if (new Date(record.date).getFullYear() == year) {
                    cases += +record.newCases
                    deaths += +record.newDeaths
                }
            })
            countrySummary[year] = {
                cases,
                deaths
            }
        }
        countriesSummaries.push(countrySummary)
    }
    return countriesSummaries
}

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
function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}
async function run() {
    while (1) {
        await update()
        await delay(24 * 60 * 60 * 1000)
    }
}

// update()

app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`)
    run()
})