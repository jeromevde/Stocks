# Stock Tracker Application

A full html javascript simple stock tracker that allows to search from yahoo stocks and add stocks with 
- a date, from which it will compute the cumulative return
- label the stocks with a label you can filter with
- add short notes for each stock
- clicking on the stock should open an iframe to yahoo finance
upload the added stocks to a markdown file to github of the portfolio, handle authentication

## Overview
The Stock Tracker is a simple web application that allows users to track their stock investments. Users can search for stocks from Yahoo Finance, add them to their portfolio with specific details, and compute cumulative returns based on a specified date. The application also allows users to label stocks for easy filtering and add short notes for each stock.

## Features
- Search for stocks using Yahoo Finance.
- Add stocks with:
  - Date for cumulative return calculation.
  - Custom labels for filtering.
  - Short notes for personal reference.
- Click on a stock to open its Yahoo Finance page in an iframe.
- Automatically upload the portfolio to a markdown file on GitHub.


## Installation
```
npx live-server src --port=8080 
```