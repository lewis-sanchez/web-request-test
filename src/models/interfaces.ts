/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDeferred<T, E extends Error = Error> {
    resolve: (result: T | Promise<T>) => void;
    reject: (reason: E) => void;
}
