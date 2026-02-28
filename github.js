/**
 * GitHub API client for portfolio persistence
 */
const TokenStore = {
    get(name) {
        const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
        if (m) return decodeURIComponent(m[1]);
        return localStorage.getItem(name);
    },
    set(name, value, days = 60) {
        if (!value) return this.clear(name);
        const maxAge = Math.max(1, Math.floor(days * 24 * 60 * 60));
        document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
        localStorage.setItem(name, value);
    },
    clear(name) {
        document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
        localStorage.removeItem(name);
    }
};
window.TokenStore = TokenStore;

class GitHubClient {
    // Chunk size for base64 encoding to avoid "Maximum call stack size exceeded"
    // when spreading large arrays into String.fromCharCode()
    static ENCODING_CHUNK_SIZE = 8192;

    constructor() {
        this.API_URL = 'https://api.github.com';
        this.token = TokenStore.get('github_token');
        this.repoOwner = TokenStore.get('github_repo_owner') || localStorage.getItem('github_owner') || 'jeromevde';
        this.repoName = TokenStore.get('github_repo_name') || localStorage.getItem('github_repo') || 'Stocks';
        this.filePath = 'portfolio.html';
        this.lastKnownSha = localStorage.getItem('portfolio_sha');
    }

    isAuthenticated() { return !!this.token; }

    authenticate(token, owner, repo) {
        this.token = token;
        this.repoOwner = owner;
        this.repoName = repo;
        TokenStore.set('github_token', token);
        TokenStore.set('github_repo_owner', owner);
        TokenStore.set('github_repo_name', repo);
        localStorage.setItem('github_owner', owner);
        localStorage.setItem('github_repo', repo);
    }

    logout() {
        this.token = null;
        ['github_token', 'github_repo_owner', 'github_repo_name', 'github_owner', 'github_repo', 'portfolio_sha'].forEach(k => TokenStore.clear(k));
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
        this.lastKnownSha = data.sha;
        localStorage.setItem('portfolio_sha', data.sha);
        let content;
        if (data.content) {
            // Decode base64 → raw bytes → UTF-8 string
            const raw = atob(data.content.replace(/\s/g, ''));
            content = new TextDecoder('utf-8').decode(
                Uint8Array.from(raw, c => c.charCodeAt(0))
            );
        } else if (data.download_url) {
            // File too large for contents API (>1 MiB) — fetch raw directly
            const rawRes = await fetch(data.download_url);
            if (!rawRes.ok) throw new Error(`Download failed: ${rawRes.status}`);
            content = await rawRes.text();
        } else {
            throw new Error('No content available from GitHub API');
        }
        return { exists: true, content, sha: data.sha };
    }

    async saveFile(content, message = 'Update portfolio') {
        // Get current SHA
        const current = await this.loadFile();
        const url = `${this.API_URL}/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}`;
        // Convert to base64 in chunks to avoid "Maximum call stack size exceeded"
        const bytes = new TextEncoder().encode(content);
        let binaryString = '';
        for (let i = 0; i < bytes.length; i += GitHubClient.ENCODING_CHUNK_SIZE) {
            const chunk = bytes.slice(i, i + GitHubClient.ENCODING_CHUNK_SIZE);
            binaryString += String.fromCharCode(...chunk);
        }
        const base64 = btoa(binaryString);
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
