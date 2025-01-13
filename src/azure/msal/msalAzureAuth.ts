/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AuthenticationResult,
} from "@azure/msal-node";
import * as url from "url";
import * as vscode from "vscode";
import {
    AccountType,
    AzureAuthType,
    IAccount,
    IPromptFailedResult,
    IProviderSettings,
    ITenant,
} from "../../models/contracts/azure";
import { IDeferred } from "../../models/interfaces";
import { AzureAuthError } from "../azureAuthError";
import * as Constants from "../constants";
import { ErrorResponseBody } from "@azure/arm-subscriptions";
import { makeGetRequestWithToken } from "../../network/request";

export type GetTenantsResponseData = {
    value: ITenantResponse[];
};
export type ErrorResponseBodyWithError = Required<ErrorResponseBody>;

export abstract class MsalAzureAuth {
    protected readonly loginEndpointUrl: string;
    protected readonly redirectUri: string;
    protected readonly scopes: string[];
    protected readonly clientId: string;

    constructor(
        protected readonly providerSettings: IProviderSettings,
        protected readonly context: vscode.ExtensionContext,
        protected readonly authType: AzureAuthType,
    ) {
        this.loginEndpointUrl =
            this.providerSettings.loginEndpoint ??
            "https://login.microsoftonline.com/";
        this.redirectUri = "http://localhost";
        this.clientId = this.providerSettings.clientId;
        this.scopes = [...this.providerSettings.scopes];
    }

    public async startLogin(): Promise<IAccount | IPromptFailedResult> {
        let loginComplete: IDeferred<void, Error> | undefined = undefined;
        try {
            console.log("Starting login");
            if (!this.providerSettings.resources.windowsManagementResource) {
                throw new Error(`Provider '${this.providerSettings.displayName}' does not have a Microsoft resource endpoint defined.`);
            }
            const result = await this.login(Constants.organizationTenant);
            loginComplete = result.authComplete;
            if (!result?.response || !result.response?.account) {
                console.error(`Authentication failed: ${loginComplete}`);
                return {
                    canceled: false,
                };
            }
            const token: IToken = {
                token: result.response.accessToken,
                key: result.response.account.homeAccountId,
                tokenType: result.response.tokenType,
            };
            const tokenClaims = <ITokenClaims>result.response.idTokenClaims;
            const account = await this.hydrateAccount(token, tokenClaims);
            loginComplete?.resolve();
            return account;
        } catch (ex) {
            console.error(`Login failed: ${ex}`);
            if (ex instanceof AzureAuthError) {
                if (loginComplete) {
                    loginComplete.reject(ex);
                    console.error(ex);
                } else {
                    void vscode.window.showErrorMessage(ex.message);
                    console.error(ex.originalMessageAndException);
                }
            } else {
                console.error(ex);
            }
            return {
                canceled: false,
            };
        }
    }

    public async hydrateAccount(
        token: IToken | IAccessToken,
        tokenClaims: ITokenClaims,
    ): Promise<IAccount> {
        const tenants = await this.getTenants(token.token);
        let account = this.createAccount(tokenClaims, token.key, tenants);
        return account;
    }

    protected abstract login(tenant: ITenant): Promise<{
        response: AuthenticationResult | null;
        authComplete: IDeferred<void, Error>;
    }>;

    public async getTenants(token: string): Promise<ITenant[]> {
        const tenantUri = url.resolve(
            this.providerSettings.resources.azureManagementResource.endpoint,
            "tenants?api-version=2019-11-01",
        );
        try {
            console.log("Fetching tenants with uri {0}", tenantUri);
            let tenantList: string[] = [];
            const tenantResponse =
                await makeGetRequestWithToken<GetTenantsResponseData>(
                    tenantUri,
                    token,
                );
            const data = tenantResponse.data;
            if (this.isErrorResponseBodyWithError(data)) {
                console.error(
                    `Error fetching tenants :${data.error.code} - ${data.error.message}`,
                );
                throw new Error(`${data.error.code} - ${data.error.message}`);
            }
            const tenants: ITenant[] = data.value.map(
                (tenantInfo: ITenantResponse) => {
                    if (tenantInfo.displayName) {
                        tenantList.push(tenantInfo.displayName);
                    } else {
                        tenantList.push(tenantInfo.tenantId);
                        console.info(
                            "Tenant display name found empty: {0}",
                            tenantInfo.tenantId,
                        );
                    }
                    return {
                        id: tenantInfo.tenantId,
                        displayName: tenantInfo.displayName
                            ? tenantInfo.displayName
                            : tenantInfo.tenantId,
                        userId: token,
                        tenantCategory: tenantInfo.tenantCategory,
                    } as ITenant;
                },
            );
            console.log(`Tenants: ${tenantList}`);
            const homeTenantIndex = tenants.findIndex(
                (tenant) => tenant.tenantCategory === Constants.homeCategory,
            );
            // remove home tenant from list of tenants
            if (homeTenantIndex >= 0) {
                const homeTenant = tenants.splice(homeTenantIndex, 1);
                tenants.unshift(homeTenant[0]);
            }
            console.log(`Filtered Tenants: ${tenantList}`);
            return tenants;
        } catch (ex) {
            console.error(`Error fetching tenants :${ex}`);
            throw ex;
        }
    }

    private isErrorResponseBodyWithError(
        body: any,
    ): body is ErrorResponseBodyWithError {
        return "error" in body && body.error;
    }

    public createAccount(
        tokenClaims: ITokenClaims,
        key: string,
        tenants: ITenant[],
    ): IAccount {
        console.log(
            `Token Claims acccount: ${tokenClaims.name}, TID: ${tokenClaims.tid}`,
        );
        tenants.forEach((tenant) => {
            console.log(
                `Tenant ID: ${tenant.id}, Tenant Name: ${tenant.displayName}`,
            );
        });

        // Determine if this is a microsoft account
        let accountIssuer = "unknown";

        if (
            tokenClaims.iss ===
                "https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/" ||
            tokenClaims.iss ===
                `${this.loginEndpointUrl}72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0`
        ) {
            accountIssuer = Constants.AccountIssuer.Corp;
        }
        if (tokenClaims?.idp === "live.com") {
            accountIssuer = Constants.AccountIssuer.Msft;
        }

        const name =
            tokenClaims.name ??
            tokenClaims.preferred_username ??
            tokenClaims.email ??
            tokenClaims.unique_name;
        const email =
            tokenClaims.preferred_username ??
            tokenClaims.email ??
            tokenClaims.unique_name;

        let owningTenant: ITenant = Constants.commonTenant; // default to common tenant

        // Read more about tid > https://learn.microsoft.com/azure/active-directory/develop/id-tokens
        if (tokenClaims.tid) {
            owningTenant = tenants.find((t) => t.id === tokenClaims.tid) ?? {
                id: tokenClaims.tid,
                displayName: "Microsoft Account",
            };
        } else {
            console.info(
                "Could not find tenant information from tokenClaims, falling back to common Tenant.",
            );
        }

        let displayName = name;
        if (email) {
            displayName = `${displayName} - ${email}`;
        }

        let contextualDisplayName: string;
        switch (accountIssuer) {
            case Constants.AccountIssuer.Corp:
                contextualDisplayName =
                    "Microsoft Corp";
                break;
            case Constants.AccountIssuer.Msft:
                contextualDisplayName =
                    "Microsoft Entra Account";
                break;
            default:
                contextualDisplayName = displayName;
        }

        let accountType =
            accountIssuer === Constants.AccountIssuer.Msft
                ? AccountType.Microsoft
                : AccountType.WorkSchool;

        const account: IAccount = {
            key: {
                providerId: this.providerSettings.id,
                id: key,
                accountVersion: Constants.accountVersion,
            },
            name: displayName,
            displayInfo: {
                accountType: accountType,
                userId: key,
                contextualDisplayName: contextualDisplayName,
                displayName,
                email,
                name,
            },
            properties: {
                providerSettings: this.providerSettings,
                isMsAccount: accountIssuer === Constants.AccountIssuer.Msft,
                owningTenant: owningTenant,
                tenants,
                azureAuthType: this.authType,
            },
            isStale: false,
        } as IAccount;

        return account;
    }
}

export interface IAccountKey {
    /**
     * Account Key - uniquely identifies an account
     */
    key: string;
}

export interface IAccessToken extends IAccountKey {
    /**
     * Access Token
     */
    token: string;
}

export interface ITenantResponse {
    // https://docs.microsoft.com/en-us/rest/api/resources/tenants/list
    id: string;
    tenantId: string;
    displayName?: string;
    tenantCategory?: string;
}

export interface IToken extends IAccountKey {
    /**
     * Access token
     */
    token: string;

    /**
     * Access token expiry timestamp
     */
    expiresOn?: number;

    /**
     * TokenType
     */
    tokenType: string;
}

export interface ITokenClaims {
    // https://docs.microsoft.com/en-us/azure/active-directory/develop/id-tokens
    /**
     * Identifies the intended recipient of the token. In id_tokens, the audience
     * is your app's Application ID, assigned to your app in the Azure portal.
     * This value should be validated. The token should be rejected if it fails
     * to match your app's Application ID.
     */
    aud: string;
    /**
     * Identifies the issuer, or 'authorization server' that constructs and
     * returns the token. It also identifies the Microsoft Entra tenant for which
     * the user was authenticated. If the token was issued by the v2.0 endpoint,
     * the URI will end in /v2.0. The GUID that indicates that the user is a consumer
     * user from a Microsoft account is 9188040d-6c67-4c5b-b112-36a304b66dad.
     * Your app should use the GUID portion of the claim to restrict the set of
     * tenants that can sign in to the app, if applicable.
     */
    iss: string;
    /**
     * 'Issued At' indicates when the authentication for this token occurred.
     */
    iat: number;
    /**
     * Records the identity provider that authenticated the subject of the token.
     * This value is identical to the value of the Issuer claim unless the user
     * account not in the same tenant as the issuer - guests, for instance.
     * If the claim isn't present, it means that the value of iss can be used instead.
     * For personal accounts being used in an organizational context (for instance,
     * a personal account invited to an Microsoft Entra tenant), the idp claim may be
     * 'live.com' or an STS URI containing the Microsoft account tenant
     * 9188040d-6c67-4c5b-b112-36a304b66dad.
     */
    idp: string;
    /**
     * The 'nbf' (not before) claim identifies the time before which the JWT MUST NOT be accepted for processing.
     */
    nbf: number;
    /**
     * The 'exp' (expiration time) claim identifies the expiration time on or
     * after which the JWT must not be accepted for processing. It's important
     * to note that in certain circumstances, a resource may reject the token
     * before this time. For example, if a change in authentication is required
     * or a token revocation has been detected.
     */
    exp: number;
    home_oid?: string;
    /**
     * The code hash is included in ID tokens only when the ID token is issued with an
     * OAuth 2.0 authorization code. It can be used to validate the authenticity of an
     * authorization code. To understand how to do this validation, see the OpenID
     * Connect specification.
     */
    c_hash: string;
    /**
     * The access token hash is included in ID tokens only when the ID token is issued
     * from the /authorize endpoint with an OAuth 2.0 access token. It can be used to
     * validate the authenticity of an access token. To understand how to do this validation,
     * see the OpenID Connect specification. This is not returned on ID tokens from the /token endpoint.
     */
    at_hash: string;
    /**
     * An internal claim used by Microsoft Entra to record data for token reuse. Should be ignored.
     */
    aio: string;
    /**
     * The primary username that represents the user. It could be an email address, phone number,
     * or a generic username without a specified format. Its value is mutable and might change
     * over time. Since it is mutable, this value must not be used to make authorization decisions.
     * It can be used for username hints, however, and in human-readable UI as a username. The profile
     * scope is required in order to receive this claim. Present only in v2.0 tokens.
     */
    preferred_username: string;
    /**
     * The email claim is present by default for guest accounts that have an email address.
     * Your app can request the email claim for managed users (those from the same tenant as the resource)
     * using the email optional claim. On the v2.0 endpoint, your app can also request the email OpenID
     * Connect scope - you don't need to request both the optional claim and the scope to get the claim.
     */
    email: string;
    /**
     * The name claim provides a human-readable value that identifies the subject of the token. The value
     * isn't guaranteed to be unique, it can be changed, and it's designed to be used only for display purposes.
     * The profile scope is required to receive this claim.
     */
    name: string;
    /**
     * The nonce matches the parameter included in the original /authorize request to the IDP. If it does not
     * match, your application should reject the token.
     */
    nonce: string;
    /**
     * The immutable identifier for an object in the Microsoft identity system, in this case, a user account.
     * This ID uniquely identifies the user across applications - two different applications signing in the
     * same user will receive the same value in the oid claim. The Microsoft Graph will return this ID as
     * the id property for a given user account. Because the oid allows multiple apps to correlate users,
     * the profile scope is required to receive this claim. Note that if a single user exists in multiple
     * tenants, the user will contain a different object ID in each tenant - they're considered different
     * accounts, even though the user logs into each account with the same credentials. The oid claim is a
     * GUID and cannot be reused.
     */
    oid: string;
    /**
     * The set of roles that were assigned to the user who is logging in.
     */
    roles: string[];
    /**
     * An internal claim used by Azure to revalidate tokens. Should be ignored.
     */
    rh: string;
    /**
     * The principal about which the token asserts information, such as the user
     * of an app. This value is immutable and cannot be reassigned or reused.
     * The subject is a pairwise identifier - it is unique to a particular application ID.
     * If a single user signs into two different apps using two different client IDs,
     * those apps will receive two different values for the subject claim.
     * This may or may not be wanted depending on your architecture and privacy requirements.
     */
    sub: string;
    /**
     * Represents the tenant that the user is signing in to. For work and school accounts,
     * the GUID is the immutable tenant ID of the organization that the user is signing in to.
     * For sign-ins to the personal Microsoft account tenant (services like Xbox, Teams for Life, or Outlook),
     * the value is 9188040d-6c67-4c5b-b112-36a304b66dad.
     */
    tid: string;
    /**
     * Only present in v1.0 tokens. Provides a human readable value that identifies the subject of the token.
     * This value is not guaranteed to be unique within a tenant and should be used only for display purposes.
     */
    unique_name: string;
    /**
     * Token identifier claim, equivalent to jti in the JWT specification. Unique, per-token identifier that is case-sensitive.
     */
    uti: string;
    /**
     * Indicates the version of the id_token.
     */
    ver: string;
}
