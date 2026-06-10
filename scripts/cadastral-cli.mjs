#!/usr/bin/env node
import { searchByCadastralNumber } from "../lib/cadastral-search.mjs";

const cadastralNumber = process.argv[2];
if (!cadastralNumber) {
    console.error("Использование: npm run cadastral -- 77:05:0001005:19");
    process.exit(1);
}

const result = await searchByCadastralNumber(cadastralNumber);
console.log(JSON.stringify(result, null, 2));
