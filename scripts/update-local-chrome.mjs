// Compatibility entrypoint for the existing daily Chrome updater.
import { updateInstalled } from './update-installed.mjs';
console.log(JSON.stringify(await updateInstalled({browser:'chrome'})));
