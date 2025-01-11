import * as vscode from 'vscode';
import * as tunnel from 'tunnel';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

import axios, { AxiosResponse, AxiosRequestConfig } from 'axios';
import { getProxyAgentOptions } from './proxy';

interface ProxyAgent {
    isHttps: boolean;
    agent: http.Agent | https.Agent;
}

export async function makeGetRequest<T>(requestUrl: string) {
    const config: AxiosRequestConfig = {
        headers: {
            'Content-Type': 'application/json',
        },
        validateStatus: () => true,
        proxy: false
    };

    const httpConfig = vscode.workspace.getConfiguration('http');
    let proxy = loadEnvironmentProxyValue();
    if (!proxy) {
        console.log("Checking workspace HTTP configuration for proxy endpoint.");
        proxy = httpConfig['proxy'] as string;
    }

    if (proxy) {
        console.log(`Proxy endpoint: ${proxy}`);
        console.log("Is strictSSL enabled on proxy: ", httpConfig['proxyStrictSSL']);

        const agent = createProxyAgent(requestUrl, proxy, httpConfig['proxyStrictSSL']);

        if (proxy.startsWith('https')) {
            console.log("Setting https agent in axios request config.");

            config.httpsAgent = agent;
        }
        else {
            console.log("Setting http agent in axios request config.");

            config.httpAgent = agent;
        }
    }

    console.log("Sending GET request to provided request URL: ", requestUrl);
    const response: AxiosResponse = await axios.get<T>(requestUrl, config);

    return response;
}

export async function makeGetRequestWithToken<T>(requestUrl: string, token: string) {
    const config: AxiosRequestConfig = {
        headers: {
            'Content-Type': 'application/json',
             Authorization: `Bearer ${token}`,
        },
        validateStatus: () => true,
        proxy: false
    };

    const httpConfig = vscode.workspace.getConfiguration('http');
    let proxy = loadEnvironmentProxyValue();
    if (!proxy) {
        console.log("Checking workspace HTTP configuration for proxy endpoint.");
        proxy = httpConfig['proxy'] as string;
    }

    if (proxy) {
        console.log(`Proxy endpoint: ${proxy}`);
        console.log("Is strictSSL enabled on proxy: ", httpConfig['proxyStrictSSL']);

        const agent = createProxyAgent(requestUrl, proxy, httpConfig['proxyStrictSSL']);

        if (proxy.startsWith('https')) {
            console.log("Setting https agent in axios request config.");

            config.httpsAgent = agent;
        }
        else {
            console.log("Setting http agent in axios request config.");

            config.httpAgent = agent;
        }
    }

    console.log("Sending GET request to provided request URL: ", requestUrl);
    const response: AxiosResponse = await axios.get<T>(requestUrl, config);

    return response;
}

function loadEnvironmentProxyValue(): string | undefined {
    const HTTPS_PROXY = 'HTTPS_PROXY';
    const HTTP_PROXY = 'HTTP_PROXY';

    if (!process) {
        console.log("No process object found.");
        return undefined;
    }

    if (process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()]) {
        console.log("Loading proxy value from HTTPS_PROXY environment variable.");

        return process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()];
    }
    else if (process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()]) {    
        console.log("Loading proxy value from HTTP_PROXY environment variable.");
        
        return process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()];
    }

    console.log("No proxy value found in either HTTPS_PROXY or HTTP_PROXY environment variables.");
    
    return undefined;
}

function createProxyAgent(requestUrl: string, proxy: string, proxyStrictSSL: boolean): ProxyAgent {
    const agentOptions = getProxyAgentOptions(url.parse(requestUrl), proxy, proxyStrictSSL);
    if (!agentOptions || !agentOptions.host || !agentOptions.port) {
        throw new Error('Unable to read proxy agent options to create proxy agent.');
    }

    let tunnelOptions: tunnel.HttpsOverHttpsOptions = {};
    if (typeof agentOptions.auth === 'string' && agentOptions.auth) {
        console.log("Creating tunnelOptions with proxyAuth property because it is specified in proxy endpoint.");
        
        tunnelOptions = {
            proxy: {
                proxyAuth: agentOptions.auth,
                host: agentOptions.host,
                port: Number(agentOptions.port)
            }
        };

        console.log("Proxy details: ", { proxyAuth: agentOptions.auth, host: agentOptions.host, port: Number(agentOptions.port) });
    }
    else {
        console.log("Creating tunnelOptions without proxyAuth property because it's not specified in proxy endpoint.");
        
        tunnelOptions = {
            proxy: {
                host: agentOptions.host,
                port: Number(agentOptions.port)
            }
        };

        console.log("Proxy details: ", { host: agentOptions.host, port: Number(agentOptions.port) });
    }

    const isRequestHttps = requestUrl.startsWith('https');
    console.log("Is request URL protocol using HTTPS: ", isRequestHttps);

    const isProxyHttps = proxy.startsWith('https');
    console.log("Is proxy endpoint protocol using HTTPS: ", isProxyHttps);

    const proxyAgent = {
        isHttps: isRequestHttps,
        agent: createTunnelingAgent(isRequestHttps, isProxyHttps, tunnelOptions),
    } as ProxyAgent;

    return proxyAgent;
}

function createTunnelingAgent(isRequestHttps: boolean, isProxyHttps: boolean, tunnelOptions: tunnel.HttpsOverHttpsOptions): http.Agent | https.Agent {
    if (isRequestHttps && isProxyHttps) {
        console.log('Creating https over https proxy tunneling agent.');
        return tunnel.httpsOverHttps(tunnelOptions);
    }
    else if (isRequestHttps && !isProxyHttps) {
        console.log('Creating https over http proxy tunneling agent.');
        return tunnel.httpsOverHttp(tunnelOptions);
    }
    else if (!isRequestHttps && isProxyHttps) {
        console.log('Creating http over https proxy tunneling agent.');
        return tunnel.httpOverHttps(tunnelOptions);
    }
    else {
        console.log('Creating http over http proxy tunneling agent.');
        return tunnel.httpOverHttp(tunnelOptions);
    }
}
