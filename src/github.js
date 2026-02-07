/**
 * GitHub API client for portfolio persistence
 */
class GitHubClient {
    constructor() {
        this.API_URL = 'https://api.github.com';
        this.token = localStorage.getItem('github_token');
        this.repoOwner = localStorage.getItem('github_repo_owner') || 'jeromevde';
        this.repoName = localStorage.getItem('github_repo_name') || 'Stocks';
        this.filePath = 'portfolio.html';
        this.lastKnownSha = localStorage.getItem('portfolio_sha');
    }

    isAuthenticated() { return !!this.token; }

    authenticate(token, owner, repo) {
        this.token = token;
        this.repoOwner = owner;
        this.repoName = repo;
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_repo_owner', owner);
        localStorage.setItem('github_repo_name', repo);
    }

    logout() {
        this.token = null;
        ['github_token', 'github_repo_owner', 'github_repo_name', 'portfolio_sha'].forEach(k => localStorage.removeItem(k));
    }

    clearCache() {
        localStorage.removeItem('portfolio_sha');
        this.lastKnownSha = null;
    }

    async _fetch(url, opts = {}) {
        const headers = { Accept: 'application/vnd.github.v3+json', ...opts.headers };
        if (this.token) headers.Authorization = `token ${this.token}`;
        if (opts.body) headers['Content-Type'] = 'application/json';
        const res = await fetch(url, { ...opts, headers });
        return res;
    }

    async loadFile() {
        const url = `${this.API_URL}/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}?t=${Date.now()}`;
        const res = await this._fetch(url);
        if (res.status === 404) return { exists: false, content: null };
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const data = await res.json();
        const content = atob(data.content.replace(/\s/g, ''));
        this.lastKnownSha = data.sha;
        localStorage.setItem('portfolio_sha', data.sha);
        return { exists: true, content, sha: data.sha };
    }

    async saveFile(content, message = 'Update portfolio') {
        // Get current SHA
        const current = await this.loadFile();
        const url = `${this.API_URL}/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}`;
        const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)));
        const body = { message, content: base64 };
        if (current.exists) body.sha = current.sha;
        const res = await this._fetch(url, { method: 'PUT', body: JSON.stringify(body) });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`Save failed: ${res.status} ${err.message || ''}`);
        }
        const result = await res.json();
        this.lastKnownSha = result.content.sha;
        localStorage.setItem('portfolio_sha', this.lastKnownSha);
        return result;
    }
}

try {
    window.githubClient = new GitHubClient();
    console.log('GitHub client:', window.githubClient.isAuthenticated() ? 'authenticated' : 'not authenticated');
} catch (e) {
    console.error('GitHub init failed:', e);
    window.githubClient = null;
}
