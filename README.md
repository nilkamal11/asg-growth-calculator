# Growth and achievement calculator — R in the browser

A standalone HTML calculator that runs its calculations in **R through WebR**. HTML, CSS and JavaScript provide the controls, tables and chart; the R engine produces the numerical results. No Tableau viewer license or hosted R process is needed for this browser version.

This is a **review draft** using a frozen 2025 student-norm parameter snapshot. It is not a newly fitted model or an official production release.

## Run locally

Serve this directory with a static HTTP server, for example:

```sh
python -m http.server 8784 --bind 127.0.0.1
```

Open `http://127.0.0.1:8784/`. An internet connection is needed to download the pinned WebR runtime on first load. Opening `index.html` directly as a `file://` URL is not supported.

## Publish with GitHub Pages

1. Put these application files into a dedicated repository.
2. Under **Settings → Pages**, choose **Deploy from a branch**, branch **main**, folder **/(root)**.
3. Use the published URL GitHub supplies after deployment succeeds.

All paths are relative so a GitHub project-site subdirectory can be used. This app uses WebR's PostMessage channel, which does not require special cross-origin-isolation response headers. The `.nojekyll` file disables Jekyll processing.

For an existing website, embed the published URL in an iframe with a descriptive title and sufficient height. The surrounding website must allow the iframe and WebR's browser capabilities. Verify the actual embedding context before release.

## Editable files

- `index.html`, `styles.css`, `app.js`: presentation and interaction.
- `calculator-r.js`: loads the pinned WebR runtime, stages the R source/reference tables into its virtual filesystem, and calls the R engine.
- `r/norms_engine.R`: the R calculation code, reusable separately in RStudio. Browser loading uses a browser filesystem path rather than a particular computer's home directory.
- `data/`: frozen normative lookup tables and integrity metadata. These contain reference parameters, not individual student records.

After changing numerical code or reference tables, repeat the reference and browser checks deliberately. Do not silently refresh data or substitute another percentile method.

## Methods and limits

- Exact five-key growth lookup: subject, starting grade, ending grade, starting week and ending week.
- Independent starting/ending achievement lookup; optional ending inputs preserve available forecasts/status results.
- Conditional projection: `P2 + (V12 / V11) * (starting_RIT - P1)`.
- Conditional growth SD: `sqrt(V22 - V12^2 / V11)`.
- CGI: `(observed_growth - conditional_projection) / conditional_growth_SD`.
- Displayed percentiles use the preserved **M05 cubic-logistic** equation, evaluated with a stable sign branch. Positive ties round upward, with displays limited to 1–99. Exact R `pnorm` is a separate diagnostic, not a replacement method.
- Invalid asymmetric covariance rows remain excluded. Mathematics/Reading grade-12 achievement means, SDs and percentiles remain withheld. Source lineage and these grade-12 exceptions still need owner review before production use.

The frozen snapshot contains 75,720 unique valid growth keys and 1,848 independent achievement keys, including 84 withheld Mathematics/Reading grade-12 achievement rows. Source hashes and row counts are checked when the engine loads.

## Runtime documentation

- [WebR: R in the browser](https://docs.r-wasm.org/webr/latest/)
- [GitHub Pages publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

The runtime has a pinned version in `calculator-r.js`. Treat a runtime upgrade as a change requiring regression checks. Browser/mobile compatibility and startup performance must be assessed in the intended deployment environment.
