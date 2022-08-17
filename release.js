const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const fetch = require('node-fetch');

async function run() {
    try {
        const { ticketId, auth_token, org_id } = process.env;
        
        const tags = (await getCommandResult('git', ['tag']))
            .split('\n')
            .filter((str) => str !== '');
        const currentRelease = tags[tags.length - 1];

        const tag_options = tags.length === 1 ? currentRelease : `${currentRelease}...${tags[tags.length - 2]}`;
        const commitLogs = await getCommandResult('git', ['log', '--pretty=format:"%h %an %s"', tag_options]);
        const prepareCommitLogs = commitLogs.split('\n').map((log) => log.replace(/"/g, '')).join('\n');

        await fetch(`https://api.tracker.yandex.net/v2/issues/${ticketId}`, {
            method: 'PATCH',
            headers: getHeaders(auth_token, org_id),
            body: JSON.stringify({
                summary: getTitle(currentRelease.split('-')[1], new Date().toLocaleDateString()),
                description: getDescriptions(github.context.payload.pusher.name, prepareCommitLogs),
            }),
        });

        const code = await exec.exec('docker', ['build', '-t', `app:${currentRelease}`, '.']);

        if (code !== 0) {
            throw new Error('fail build docker image');
        }

        await fetch(`https://api.tracker.yandex.net/v2/issues/${ticketId}/comments`, {
            method: 'POST',
            headers: getHeaders(auth_token, org_id),
            body: JSON.stringify({
                text: getComment(currentRelease),
            }),
        });  
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();

async function getCommandResult(command, args) {
    let result = '';
    let resultError = '';

    await exec.exec(command, args, {
        listeners: {
            stdout: (data) => {
                result += data.toString();
            },
            stderr: (data) => {
                resultError += data.toString();
            },
        }
    });

    if (resultError !== '') {
        throw new Error(resultError);
    }

    return result;
}

function getHeaders(auth_token, org_id) {
    return {
        'Authorization': `OAuth ${auth_token}`,
        'X-Org-ID': org_id,        
    };
}

function getDescriptions(authorName, commits) {
    return `Ответственный за релиз ${authorName}\n\nКоммиты, попавшие в релиз:\n${commits}`;
}

function getTitle(releaseNumber, date) {
    return `Релиз №${releaseNumber} от ${date}`;
}

function getComment(releaseTag) {
    return `Собрали образ с тегом ${releaseTag}`;
}
