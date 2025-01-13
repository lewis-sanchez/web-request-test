/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITenant } from "../models/contracts/azure";

export const homeCategory = "Home";

/** MSAL Account version */
export const accountVersion = "2.0";

export const selectAccount = "select_account";

export const commonTenant: ITenant = {
    id: "common",
    displayName: "common",
};

export const organizationTenant: ITenant = {
    id: "organizations",
    displayName: "organizations",
};

/**
 * Account issuer as received from access token
 */
export enum AccountIssuer {
    Corp = "corp",
    Msft = "msft",
}
