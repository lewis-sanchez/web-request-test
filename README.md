# web-request-test README

This extension sends a web request using axios, and is intended to test if manually configuring a proxy agent for axios works in proxy environments

## Features

The extension features two commands. The first command makes a GET request to the user provided URL named "Make Get Request Test". To invoke this command, open the command palette and enter "Make Get Request" then provide a URL to any website and press 'Enter'.  The second commmand is named "Add AAD Account Test", this command will open a browser window and allow the user to sign into their Azure account to test that the changes made to the Axios configuration in Azure Data Studio will work in proxy environments.

## Known Issues

There aren't any known issues at this time.

## Release Notes

### 0.0.1

Initial release of the Web Request Test extension.
