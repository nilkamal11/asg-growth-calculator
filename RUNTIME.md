# R runtime adapter

The HTML interface calls the reviewed R engine through pinned **WebR 0.6.0**, downloaded from the official `webr.r-wasm.org` CDN. The R interpreter runs in a browser worker using the documented **PostMessage** communication mode. A running R server, Shiny installation and COOP/COEP response headers are not required. HTTPS or localhost static hosting is required; opening the HTML directly as a local file is unsupported.

The first visit downloads the R runtime plus approximately 2.16 MB of compressed normative tables. Source, table and fixture SHA256 hashes are pinned in **calculator-r.js**. R independently verifies the two compressed table MD5 checksums, unique keys, covariance validity, row counts, source hash and grade-12 quarantine. Assets are loaded into the browser's virtual **/app** filesystem. They do not read the visitor's local files.

## Public files and source scope

The engine in **r/norms_engine.R** differs from the editable desktop R engine only in its path-discovery helper, which points to the virtual directory. Percentile, input, status, growth, rounding and source-guard functions are unchanged. **data/browser_asset_manifest.json** records the original and browser-adapted hashes. The normative tables contain aggregate lookup parameters, not participant records. Only the allowlisted source/data files are included; no desktop R package library, private correspondence, source workbook, or local filesystem paths are needed.

All browser visitors receive the published R source and normative tables. This project is a review implementation, not production approval. The source exceptions and package/coefficient lineage remain review items. Invalid covariance rows are excluded without repair; 84 Mathematics/Reading grade-12 achievement rows remain quarantined. Valid growth can remain available when ending achievement is withheld.

## JavaScript contract

```js
import { initializeR, calculate, runSelfChecks } from './calculator-r.js';

await initializeR({ onStatus: message => console.log(message) });
const result = await calculate({
  subject: 'read', start_grade: 6, end_grade: 6, start_week: 4,
  end_week: '32', start_rit: 180, end_rit: '204', include_actual: true,
});
const checks = await runSelfChecks();
```

Subject codes are **math**, **read**, **lang** and **sci**. Ending week and ending RIT accept a blank string. Omitted properties use the documented example defaults. Invalid required arguments reject with an Error. The adapter passes typed arguments to a fixed R function call; user input is not evaluated as source code. Calls are serialized and temporary R objects are released after conversion.

The returned plain object has this shape. All R missing values become JavaScript `null`, and every metric is scalar:

```text
inputs: subject, subject_label, start_grade, end_grade, start_week,
        end_week, start_rit, end_rit, include_actual
achievement.start and achievement.end:
  mean, sd, z, percentile_raw, percentile, pnorm_raw, pnorm_percentile,
  withheld, source_row, source_sheet
growth:
  conditional_projection, conditional_sd, projected_ending_rit, observed,
  cgi, cgp_raw, cgp, grade_average_growth, pnorm_raw, pnorm_percentile
growth_available: boolean
warnings: array of strings
source:
  growth_row, growth_sheet, parameters: {P1,P2,V11,V12,V21,V22} or null,
  parameter_workbook_sha256
```

**M05 is the calculator's percentile method.** The `pnorm_*` fields are diagnostic comparisons only; they never replace the M05 values. JavaScript does not duplicate the normative equations or percentile rounding.

`runSelfChecks()` runs the actual browser R engine against 12 independent pinned M01/M02/M05 fixture scenarios (192 numerical/missing-value comparisons), plus 25 source, method and input-guard checks. It resolves to `{passed, total, all_passed, golden_scenarios, independent_numeric_comparisons, checks}`. `passed` is the number of successful checks and `all_passed` is a boolean. Each item in `checks` contains `name` and a boolean `passed`. A successful result is **217 of 217**. Visual layout, mobile behavior and production suitability are separate checks.

Changing a source asset intentionally requires updating its pinned SHA256 in the adapter and manifest and repeating the self-checks. Browser R and desktop R can differ in runtime version; equality is established through the regression tests, not assumed from matching source text.

## Official runtime references

- [WebR](https://docs.r-wasm.org/)
- [Worker communication](https://docs.r-wasm.org/webr/v0.6.0/communication.html)
- [R to JavaScript conversion](https://docs.r-wasm.org/webr/latest/convert-r-to-js.html)
- [Managing R object memory](https://docs.r-wasm.org/webr/latest/objects.html)
