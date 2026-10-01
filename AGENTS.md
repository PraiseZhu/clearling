# Clearling

Source for the Clearling Chromium MV3 translation extension.

- Use Node 24+, native browser APIs and the existing module boundaries.
- Never include credentials, browser profiles or page contents in the repository.
- Keep public model fixtures separate from live model results. A passing fake
  provider test does not establish gateway compatibility or translation quality.
- Run `npm test` and `npm run build` after changes. Validate real MV3 behavior in
  an isolated browser profile before claiming installation or automatic translation.
- Do not operate Cindy's UI or use desktop computer automation.
- Commit, push and publishing require matching user authorization.
