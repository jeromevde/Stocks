class GitHubClient {
    constructor() {
        this.API_URL = 'https://api.github.com';
        this.token = localStorage.getItem('github_token');
        this.repoOwner = localStorage.getItem('github_repo_owner') || 'jeromevde'; // Default from repo context
        this.repoName = localStorage.getItem('github_repo_name') || 'Stocks'; // Default from repo context
        this.filePath = 'portfolio.md';
        this.lastKnownSha = localStorage.getItem('portfolio_sha');
        this.lastKnownContent = localStorage.getItem('portfolio_content');
        this.lastSavedHash = localStorage.getItem('portfolio_saved_hash');
    }

    isAuthenticated() {
        return !!this.token;
    }

    authenticate(token, repoOwner, repoName) {
        this.token = token;
        this.repoOwner = repoOwner;
        this.repoName = repoName;
        
        // Store in localStorage
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_repo_owner', repoOwner);
        localStorage.setItem('github_repo_name', repoName);
    }

    getHeaders() {
        if (!this.token) {
            throw new Error('Not authenticated. Please provide a GitHub token.');
        }
        return {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };
    }

    getPublicHeaders() {
        return {
            'Accept': 'application/vnd.github.v3+json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };
    }

    async getCurrentFileInfo() {
        // Add timestamp to prevent caching
        const timestamp = Date.now();
        const url = `${this.API_URL}/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}?t=${timestamp}`;
        
        try {
            // Try without authentication first for public repos (with cache-busting headers)
            let response = await fetch(url, {
                headers: this.getPublicHeaders(),
                method: 'GET'
            });
            
            // If unauthorized and we have a token, try with authentication
            if (!response.ok && response.status === 401 && this.token) {
                response = await fetch(url, { 
                    headers: this.getHeaders(),
                    method: 'GET'
                });
            }
            
            if (response.status === 404) {
                // File doesn't exist yet
                return { exists: false, sha: null, content: null };
            }
            
            if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                if (errorData.message && errorData.message.includes('rate limit')) {
                    throw new Error('GitHub API rate limit exceeded. Please try again later.');
                }
                throw new Error('GitHub API access forbidden. Repository may be private or you need authentication.');
            }
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}${errorData.message ? ` - ${errorData.message}` : ''}`);
            }
            
            const data = await response.json();
            const content = atob(data.content.replace(/\s/g, '')); // Decode base64 and remove whitespace
            
            return {
                exists: true,
                sha: data.sha,
                content: content,
                size: data.size,
                lastModified: data.commit?.committer?.date || new Date().toISOString()
            };
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Network error: Unable to connect to GitHub. Check your internet connection.');
            }
            throw new Error(`Failed to fetch file info: ${error.message}`);
        }
    }

    async checkForConflicts(newContent) {
        try {
            const currentInfo = await this.getCurrentFileInfo();
            
            if (!currentInfo.exists) {
                return { hasConflict: false, currentInfo };
            }
            
            // Check if SHA has changed since last known state
            if (this.lastKnownSha && currentInfo.sha !== this.lastKnownSha) {
                return { 
                    hasConflict: true, 
                    currentInfo,
                    message: 'File has been modified by someone else since your last sync. Please review changes before saving.'
                };
            }
            
            return { hasConflict: false, currentInfo };
        } catch (error) {
            throw new Error(`Conflict check failed: ${error.message}`);
        }
    }

    async saveFile(content, commitMessage = 'Update portfolio') {
        try {
            // Check for conflicts first
            const conflictCheck = await this.checkForConflicts(content);
            
            if (conflictCheck.hasConflict) {
                throw new Error(conflictCheck.message);
            }
            
            const currentInfo = conflictCheck.currentInfo;
            const url = `${this.API_URL}/repos/${this.repoOwner}/${this.repoName}/contents/${this.filePath}`;
            
            const body = {
                message: commitMessage,
                content: btoa(content), // Encode to base64
            };
            
            // Include SHA if file exists (for updates)
            if (currentInfo.exists) {
                body.sha = currentInfo.sha;
            }
            
            const response = await fetch(url, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(body)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}. ${errorData.message || ''}`);
            }
            
            const result = await response.json();
            
            // Update our local tracking
            this.lastKnownSha = result.content.sha;
            this.lastKnownContent = content;
            localStorage.setItem('portfolio_sha', this.lastKnownSha);
            localStorage.setItem('portfolio_content', this.lastKnownContent);
            
            return {
                success: true,
                sha: result.content.sha,
                commit: result.commit,
                message: 'Portfolio saved successfully to GitHub!'
            };
        } catch (error) {
            throw new Error(`Failed to save file: ${error.message}`);
        }
    }

    async loadFile() {
        try {
            const fileInfo = await this.getCurrentFileInfo();
            
            if (!fileInfo.exists) {
                return { exists: false, content: null };
            }
            
            // Update our local tracking
            this.lastKnownSha = fileInfo.sha;
            this.lastKnownContent = fileInfo.content;
            localStorage.setItem('portfolio_sha', this.lastKnownSha);
            localStorage.setItem('portfolio_content', this.lastKnownContent);
            
            return {
                exists: true,
                content: fileInfo.content,
                sha: fileInfo.sha,
                lastModified: fileInfo.lastModified
            };
        } catch (error) {
            throw new Error(`Failed to load file: ${error.message}`);
        }
    }

    logout() {
        this.token = null;
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_repo_owner');
        localStorage.removeItem('github_repo_name');
        localStorage.removeItem('portfolio_sha');
        localStorage.removeItem('portfolio_content');
        localStorage.removeItem('portfolio_saved_hash');
    }

    calculateContentHash(content) {
        // Simple hash function for content comparison
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }

    hasUnsavedChanges(currentContent) {
        if (!this.lastSavedHash) return false;
        const currentHash = this.calculateContentHash(currentContent);
        return this.lastSavedHash !== currentHash;
    }

    markAsSaved(content) {
        this.lastSavedHash = this.calculateContentHash(content);
        localStorage.setItem('portfolio_saved_hash', this.lastSavedHash.toString());
    }
}

// Create global instance
try {
    window.githubClient = new GitHubClient();
    console.log('GitHub client initialized:', window.githubClient.isAuthenticated() ? 'authenticated' : 'not authenticated');
} catch (error) {
    console.error('Failed to initialize GitHub client:', error);
    window.githubClient = null;
}