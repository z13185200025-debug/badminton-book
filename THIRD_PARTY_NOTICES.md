# Third-party software

Release archives bundle these unmodified npm dependencies and their upstream license files:

| Package | License | Source |
| --- | --- | --- |
| playwright-core | Apache-2.0 | https://github.com/microsoft/playwright |
| pngjs | MIT | https://github.com/pngjs/pngjs |
| fflate | MIT | https://github.com/101arrowz/fflate |

See `package-lock.json` for exact versions and integrity hashes. Node.js and browsers are installed separately from their official providers. The application does not redistribute Chrome or Edge.

The preserved Mac archive has its own original dependency set and includes the corresponding licenses in `node_modules`.
