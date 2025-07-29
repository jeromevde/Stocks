# Stock Tracker Application

A full HTML/JavaScript stock tracker that allows you to search Yahoo Finance stocks and manage your portfolio with:
- Date-based cumulative return calculations
- Customizable labels for filtering
- Personal notes for each stock
- Clickable tickers that open Yahoo Finance
- GitHub integration for portfolio persistence

## Features

### 📊 **Portfolio Management**
- Search for stocks using Yahoo Finance
- Add stocks with purchase dates for return calculation
- Custom labels for filtering and organization
- Personal notes for investment thesis
- Star important stocks for priority viewing
- Remove stocks with confirmation

### 💾 **Smart Saving**
- **Public repo access**: View portfolios without API key
- **Smart save button**: Only enabled when changes exist
- **Unsaved changes warning**: Prevents accidental data loss
- **Automatic loading**: Loads portfolio on page visit
- **Authentication only for saving**: GitHub token only needed for saves

### 🎯 **User Experience**
- Real-time price updates from Yahoo Finance
- Weekend/holiday date handling
- Immediate UI feedback with async loading
- Responsive design for mobile and desktop
- Keyboard shortcuts and intuitive interactions

## How It Works

### 🔄 **Automatic Loading**
- Portfolio loads automatically from your public GitHub repo
- No authentication required for viewing
- Real-time price calculations on load

### 💡 **Smart Save System**
1. **Make changes**: Add stocks, edit notes, modify labels
2. **Save button activates**: Button becomes clickable when changes exist
3. **Authentication prompt**: Only asks for GitHub token when you try to save
4. **Unsaved changes warning**: Warns before leaving page with unsaved changes

### 🔐 **GitHub Integration**
- **Reading**: Works with public repos without authentication
- **Writing**: Requires GitHub Personal Access Token with 'repo' scope
- **Data format**: Stores only static data (no prices) in markdown
- **Version control**: Each save creates a commit with stock count

## Installation & Setup

### Local Development
```bash
# Clone the repository
git clone https://github.com/jeromevde/Stocks.git
cd Stocks

# Start local server
npx live-server src --port=8080
```

### GitHub Pages Deployment
1. **Push to GitHub**: Commit your code changes with `[ci]`, `[deploy]`, or `[build]` in message
2. **Enable Pages**: Go to repository Settings → Pages
3. **Set source**: Select "GitHub Actions" as source
4. **Deploy**: Triggered automatically by deployment keywords in commit messages

### Portfolio Setup
1. **Visit your deployed site**
2. **Add stocks**: Use the search bar to add stocks to your portfolio
3. **Customize**: Add labels, notes, and set purchase dates
4. **Save**: Click "Save to GitHub" when ready (will prompt for GitHub token)

## Usage Examples

### Adding Stocks
```
Type "AAPL" → Press Enter → Stock appears with loading indicators
Prices and returns calculate automatically from Yahoo Finance
```

### Saving Portfolio
```
Make changes → Save button becomes active → Click to save
First time: Enter GitHub token → Subsequent saves: automatic
```

### Managing Labels
```
Click label area → Type label name → Press Enter
Click × on any label to remove it
Use label filter dropdown to filter portfolio
```


## Installation
```
npx live-server src --port=8080 
```