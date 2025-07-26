const GITHUB_API_URL = 'https://api.github.com';
const REPO_OWNER = 'your-github-username'; // Replace with your GitHub username
const REPO_NAME = 'your-repo-name'; // Replace with your repository name
const TOKEN = 'your-personal-access-token'; // Replace with your GitHub personal access token

async function authenticate() {
    const headers = {
        'Authorization': `token ${TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
    };
    return headers;
}

async function uploadPortfolio(portfolioContent) {
    const headers = await authenticate();
    const url = `${GITHUB_API_URL}/repos/${REPO_OWNER}/${REPO_NAME}/contents/portfolio.md`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify({
            message: 'Update portfolio',
            content: btoa(portfolioContent), // Encode content to base64
            sha: await getFileSha() // Get the SHA of the existing file to update
        })
    });

    if (!response.ok) {
        throw new Error('Failed to upload portfolio: ' + response.statusText);
    }

    return response.json();
}

async function getFileSha() {
    const headers = await authenticate();
    const url = `${GITHUB_API_URL}/repos/${REPO_OWNER}/${REPO_NAME}/contents/portfolio.md`;

    const response = await fetch(url, { headers: headers });
    if (!response.ok) {
        throw new Error('Failed to get file SHA: ' + response.statusText);
    }

    const data = await response.json();
    return data.sha;
}

export { uploadPortfolio };