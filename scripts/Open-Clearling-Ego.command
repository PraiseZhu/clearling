#!/bin/zsh
clearling_script_dir="${0:A:h}"
exec /usr/local/bin/node "$clearling_script_dir/open-browser.mjs" ego
