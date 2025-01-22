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
    console.log('[ext: web-request-test] makeGetRequest called with requestUrl: ', requestUrl);

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
        console.log("[ext: web-request-test] Checking workspace HTTP configuration for proxy endpoint.");
        proxy = httpConfig['proxy'] as string;
    }

    if (proxy) {
        console.log('[ext: web-request-test] Found proxy endpoint: ', proxy);
        console.log("[ext: web-request-test] Is strictSSL enabled on proxy: ", httpConfig['proxyStrictSSL']);

        const agent = createProxyAgent(requestUrl, proxy, httpConfig['proxyStrictSSL']);

        if (proxy.startsWith('https')) {
            console.log("[ext: web-request-test] Setting https agent in axios request config.");

            config.httpsAgent = agent;
        }
        else {
            console.log("[ext: web-request-test] Setting http agent in axios request config.");

            config.httpAgent = agent;
        }
    }

    console.log("[ext: web-request-test] Sending GET request to provided request URL: ", requestUrl);
    const response: AxiosResponse = await axios.get<T>(requestUrl, config);

    return response;
}

export async function makeGetRequestWithToken<T>(requestUrl: string, token: string) {
    console.log('[ext: web-request-test] makeGetRequestWithToken called');
    const config: AxiosRequestConfig = {
        headers: {
            'Content-Type': 'application/json',
             Authorization: `Bearer ${token}`,
        },
        validateStatus: () => true,
        proxy: false,
    };

    const httpConfig = vscode.workspace.getConfiguration('http');
    let proxy = loadEnvironmentProxyValue();
    if (!proxy) {
        console.log("[ext: web-request-test] Checking workspace HTTP configuration for proxy endpoint.");
        proxy = httpConfig['proxy'] as string;
    }

    if (proxy) {
        console.log(`[ext: web-request-test] Found proxy endpoint: ${proxy}`);
        console.log("[ext: web-request-test] Is strictSSL enabled on proxy: ", httpConfig['proxyStrictSSL']);

        const agent = createProxyAgent(requestUrl, proxy, httpConfig['proxyStrictSSL']);

        if (agent.isHttps) {
            console.log("[ext: web-request-test] Setting https agent in axios request config.");

            config.httpsAgent = agent.agent;
        }
        else {
            console.log("[ext: web-request-test] Setting http agent in axios request config.");

            config.httpAgent = agent.agent;
        }

        const HTTPS_PORT = 443;
		const HTTP_PORT = 80;
		const parsedRequestUrl = url.parse(requestUrl);
		const port = parsedRequestUrl.protocol?.startsWith("https") ? HTTPS_PORT : HTTP_PORT;

        // Request URL will include HTTPS port 443 ('https://management.azure.com:443/tenants?api-version=2019-11-01'), so
        // that Axios doesn't try to reach this URL with HTTP port 80 on HTTP proxies, which result in an error. See https://github.com/axios/axios/issues/925
		const requestUrlWithPort = `${parsedRequestUrl.protocol}//${parsedRequestUrl.hostname}:${port}${parsedRequestUrl.path}`;
		const response: AxiosResponse = await axios.get<T>(requestUrlWithPort, config);
		console.log(`${response.status} response received from ${requestUrlWithPort}`);
		return response;
    }

    console.log("[ext: web-request-test] Sending GET request to provided request URL: ", requestUrl);
    const response: AxiosResponse = await axios.get<T>(requestUrl, config);
    console.log(`${response.status}-${response.statusText} response received from ${requestUrl}`);

    return response;
}

function loadEnvironmentProxyValue(): string | undefined {
    console.log('[ext: web-request-test] loadEnvironmentProxyValue called.');

    const HTTPS_PROXY = 'HTTPS_PROXY';
    const HTTP_PROXY = 'HTTP_PROXY';

    if (!process) {
        console.log("[ext: web-request-test] No process object found.");
        return undefined;
    }

    if (process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()]) {
        console.log("[ext: web-request-test] Loading proxy value from HTTPS_PROXY environment variable.");

        return process.env[HTTPS_PROXY] || process.env[HTTPS_PROXY.toLowerCase()];
    }
    else if (process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()]) {    
        console.log("[ext: web-request-test] Loading proxy value from HTTP_PROXY environment variable.");
        
        return process.env[HTTP_PROXY] || process.env[HTTP_PROXY.toLowerCase()];
    }

    console.log("[ext: web-request-test] No proxy value found in either HTTPS_PROXY or HTTP_PROXY environment variables.");
    
    return undefined;
}

function createProxyAgent(requestUrl: string, proxy: string, proxyStrictSSL: boolean): ProxyAgent {
    console.log('[ext: web-request-test] createProxyAgent called.');

    const agentOptions = getProxyAgentOptions(url.parse(requestUrl), proxy, proxyStrictSSL);
    if (!agentOptions || !agentOptions.host || !agentOptions.port) {
        console.log("Unable to read proxy agent options to create proxy agent.");
        throw new Error('[ext: web-request-test] Unable to read proxy agent options to create proxy agent.');
    }

    let tunnelOptions: tunnel.HttpsOverHttpsOptions = {};
    if (typeof agentOptions.auth === 'string' && agentOptions.auth) {
        console.log("[ext: web-request-test] Creating tunnelOptions with proxyAuth property because it is specified in proxy endpoint.");
        
        tunnelOptions = {
            proxy: {
                proxyAuth: agentOptions.auth,
                host: agentOptions.host,
                port: Number(agentOptions.port)
            }
        };

        console.log("[ext: web-request-test] Proxy details: ", { proxyAuth: agentOptions.auth, host: agentOptions.host, port: Number(agentOptions.port) });
    }
    else {
        console.log("[ext: web-request-test] Creating tunnelOptions without proxyAuth property because it's not specified in proxy endpoint.");
        
        tunnelOptions = {
            proxy: {
                host: agentOptions.host,
                port: Number(agentOptions.port)
            }
        };

        console.log("[ext: web-request-test] Proxy details: ", { host: agentOptions.host, port: Number(agentOptions.port) });
    }

    const isRequestHttps = requestUrl.startsWith('https');
    console.log("[ext: web-request-test] Is request URL protocol using HTTPS: ", isRequestHttps);

    const isProxyHttps = proxy.startsWith('https');
    console.log("[ext: web-request-test] Is proxy endpoint protocol using HTTPS: ", isProxyHttps);

    const proxyAgent = {
        isHttps: isProxyHttps,
        agent: createTunnelingAgent(isRequestHttps, isProxyHttps, tunnelOptions),
    } as ProxyAgent;

    return proxyAgent;
}

function createTunnelingAgent(isRequestHttps: boolean, isProxyHttps: boolean, tunnelOptions: tunnel.HttpsOverHttpsOptions): http.Agent | https.Agent {
    console.log('[ext: web-request-test] createTunnelingAgent called.');

    if (isRequestHttps && isProxyHttps) {
        console.log('[ext: web-request-test] Creating https over https proxy tunneling agent.');
        return tunnel.httpsOverHttps(tunnelOptions);
    }
    else if (isRequestHttps && !isProxyHttps) {
        console.log('[ext: web-request-test] Creating https over http proxy tunneling agent.');
        return tunnel.httpsOverHttp(tunnelOptions);
    }
    else if (!isRequestHttps && isProxyHttps) {
        console.log('[ext: web-request-test] Creating http over https proxy tunneling agent.');
        return tunnel.httpOverHttps(tunnelOptions);
    }
    else {
        console.log('[ext: web-request-test] Creating http over http proxy tunneling agent.');
        return tunnel.httpOverHttp(tunnelOptions);
    }
}
