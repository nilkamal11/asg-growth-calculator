# norms_engine.R
# Purpose: Calculate 2025 student achievement and conditional growth norms.
# Owner: Nil Shah and Codex. Updated: 2026-10-30.
# Inputs are frozen lookup parameters, never participant records or model fits.

# ---- Paths and frozen lookup data -----------------------------------------

# Browser adapter: lookup assets are mounted into WebR's virtual /app directory.
# All numerical, input, lookup and source-guard functions below are unchanged.
find_asg_directory <- function(path = "/app") {
  normalizePath(path, winslash = "/", mustWork = TRUE)
}

# Return unique growth and independent achievement tables, with source metadata.
# Integrity checks fail explicitly instead of using silently changed input files.
load_asg_norms <- function(directory = find_asg_directory()) {
  manifest <- as.list(read.dcf(file.path(directory, "data", "provenance.dcf"))[1, ])
  growth_path <- file.path(directory, "data", "growth_parameters.csv.gz")
  status_path <- file.path(directory, "data", "achievement_parameters.csv.gz")
  if (unname(tools::md5sum(growth_path)) != manifest$GrowthMD5 ||
      unname(tools::md5sum(status_path)) != manifest$StatusMD5) {
    stop("Pinned lookup file checksum changed. Review and deliberately rebuild the source snapshot.", call. = FALSE)
  }
  growth <- read.csv(gzfile(growth_path), stringsAsFactors = FALSE, na.strings = "", check.names = FALSE)
  status <- read.csv(gzfile(status_path), stringsAsFactors = FALSE, na.strings = "", check.names = FALSE)
  growth_key <- with(growth, paste(Subject, StartGrade, EndGrade, StartWeek, EndWeek, sep = "|"))
  status_key <- with(status, paste(Subject, Grade, Week, sep = "|"))
  if (anyDuplicated(growth_key) || anyDuplicated(status_key)) stop("Duplicate normative lookup key.", call. = FALSE)
  covariance_ok <- with(growth, is.finite(V11) & V11 > 0 & is.finite(V22) & V22 > 0 &
    is.finite(V12) & is.finite(V21) &
    abs(V12 - V21) <= pmax(1e-8, 1e-10 * pmax(abs(V12), abs(V21))) &
    V22 - V12 * V12 / V11 > 0 & is.finite(P1) & is.finite(P2))
  if (!all(covariance_ok)) stop("Invalid covariance or mean in pinned growth data; no repairs made.", call. = FALSE)
  quarantined <- status$Subject %in% c("math", "read") & status$Grade == 12
  stopifnot(nrow(growth) == as.integer(manifest$GrowthRows), nrow(status) == as.integer(manifest$StatusRows),
    all(status$WithholdStatus[quarantined] == 1), all(is.na(status$Mean[quarantined])),
    all(is.na(status$SD[quarantined])), sum(status$WithholdStatus) == 84,
    all(status$SD[!quarantined] > 0),
    all(growth$SourceSHA256 == manifest$ParameterWorkbookSHA256),
    all(status$SourceSHA256 == manifest$ParameterWorkbookSHA256))
  structure(list(growth = growth, status = status, growth_key = growth_key,
    status_key = status_key, provenance = manifest, directory = directory), class = "asg_norms")
}

# ---- Percentile methods and input handling --------------------------------

# M05 matches Megan's supplied equation and the current Tableau chart release.
# Use the stable sign branch to avoid exp(large positive number) in either tail.
m05_percentile <- function(z) {
  eta <- 0.07056 * z * z * z + 1.5976 * z
  result <- rep(NA_real_, length(z))
  positive <- !is.na(eta) & eta >= 0
  negative <- !is.na(eta) & eta < 0
  result[positive] <- 100 / (1 + exp(-eta[positive]))
  e <- exp(eta[negative])
  result[negative] <- 100 * e / (1 + e)
  result
}

# Tableau rounds positive percentile ties upward; R round() uses ties-to-even.
display_percentile <- function(raw) pmin(99L, pmax(1L, floor(raw + 0.5)))

scalar_text <- function(value) {
  if (is.null(value) || length(value) == 0 || (length(value) == 1 && is.na(value))) return("")
  if (length(value) != 1 || is.logical(value)) stop("Use a single numeric value or a blank.", call. = FALSE)
  trimws(as.character(value))
}

required_integer <- function(value, label, low, high) {
  text <- scalar_text(value)
  number <- suppressWarnings(as.numeric(text))
  if (!nzchar(text) || !is.finite(number) || number != floor(number) || number < low || number > high) {
    stop(paste0(label, " must be a whole number ", low, "-", high, "."), call. = FALSE)
  }
  as.integer(number)
}

score_value <- function(text) {
  grammar <- "^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$"
  if (!nzchar(text) || !grepl(grammar, text)) return(NA_real_)
  value <- suppressWarnings(as.numeric(text))
  if (!is.finite(value) || value < 100 || value > 300) NA_real_ else value
}

achievement_result <- function(norms, subject, grade, week, score) {
  empty <- list(mean = NA_real_, sd = NA_real_, z = NA_real_, percentile_raw = NA_real_,
    percentile = NA_real_, pnorm_raw = NA_real_, pnorm_percentile = NA_real_,
    withheld = FALSE, source_row = NA_integer_, source_sheet = NA_character_)
  if (is.na(week)) return(empty)
  index <- match(paste(subject, grade, week, sep = "|"), norms$status_key)
  if (is.na(index)) return(empty)
  row <- norms$status[index, ]
  empty$source_row <- row$SourceRow; empty$source_sheet <- row$SourceSheet
  empty$withheld <- row$WithholdStatus == 1
  if (empty$withheld) return(empty)
  empty$mean <- row$Mean; empty$sd <- row$SD
  if (!is.na(score)) {
    empty$z <- (score - row$Mean) / row$SD
    empty$percentile_raw <- m05_percentile(empty$z)
    empty$percentile <- display_percentile(empty$percentile_raw)
    empty$pnorm_raw <- stats::pnorm(empty$z) * 100
    empty$pnorm_percentile <- display_percentile(empty$pnorm_raw)
  }
  empty
}

# ---- Calculator ----------------------------------------------------------

# Calculate a single hypothetical case. Missing/unsupported growth never blocks
# valid independent timepoint achievement norms, and never substitutes a period.
calculate_asg <- function(norms, subject = "read", start_grade = 6, end_grade = 6,
  start_week = 4, end_week = "32", start_rit = 180, end_rit = "204", include_actual = TRUE) {
  labels <- c(math = "Mathematics", read = "Reading", lang = "Language Usage", sci = "General Science")
  aliases <- c(mathematics = "math", reading = "read", `language usage` = "lang", science = "sci", `general science` = "sci")
  subject <- tolower(scalar_text(subject))
  if (subject %in% names(aliases)) subject <- unname(aliases[subject])
  if (!subject %in% names(labels)) stop("Choose Mathematics, Reading, Language Usage or General Science.", call. = FALSE)
  start_grade <- required_integer(start_grade, "Starting grade", 0, 11)
  end_grade <- required_integer(end_grade, "Ending grade", 0, 12)
  start_week <- required_integer(start_week, "Starting week", 1, 42)
  if (!is.logical(include_actual) || length(include_actual) != 1 || is.na(include_actual)) stop("include_actual must be TRUE or FALSE.", call. = FALSE)
  start_text <- scalar_text(start_rit); start_score <- score_value(start_text)
  week_text <- scalar_text(end_week)
  week_valid <- nzchar(week_text) && grepl("^([1-9]|[1-3][0-9]|4[0-2])$", week_text)
  end_week_value <- if (week_valid) as.integer(week_text) else NA_integer_
  end_text <- scalar_text(end_rit)
  actual_score <- if (include_actual) score_value(end_text) else NA_real_
  start <- achievement_result(norms, subject, start_grade, start_week, start_score)
  end <- achievement_result(norms, subject, end_grade, end_week_value, actual_score)
  growth <- list(conditional_projection = NA_real_, conditional_sd = NA_real_, projected_ending_rit = NA_real_,
    observed = NA_real_, cgi = NA_real_, cgp_raw = NA_real_, cgp = NA_real_,
    grade_average_growth = NA_real_, pnorm_raw = NA_real_, pnorm_percentile = NA_real_)
  index <- if (week_valid) match(paste(subject, start_grade, end_grade, start_week, end_week_value, sep = "|"), norms$growth_key) else NA_integer_
  row <- if (!is.na(index)) norms$growth[index, , drop = FALSE] else NULL
  growth_available <- !is.null(row) && !is.na(start_score)
  if (growth_available) {
    # Exact M01/M02 from the current Tableau chart, with unrounded parameters.
    growth$conditional_projection <- row$P2 + (row$V12 / row$V11) * (start_score - row$P1)
    growth$conditional_sd <- sqrt(row$V22 - row$V12 * row$V12 / row$V11)
    growth$projected_ending_rit <- start_score + growth$conditional_projection
    growth$grade_average_growth <- row$P2
    if (!is.na(actual_score)) {
      growth$observed <- actual_score - start_score
      growth$cgi <- (growth$observed - growth$conditional_projection) / growth$conditional_sd
      growth$cgp_raw <- m05_percentile(growth$cgi)
      growth$cgp <- display_percentile(growth$cgp_raw)
      growth$pnorm_raw <- stats::pnorm(growth$cgi) * 100
      growth$pnorm_percentile <- display_percentile(growth$pnorm_raw)
    }
  }
  warnings <- character()
  if (is.na(start_score)) warnings <- c(warnings, "Starting RIT must be 100-300. Available achievement means and SDs remain visible.")
  if (!nzchar(week_text)) warnings <- c(warnings, "Starting achievement only. Enter an ending week for ending achievement and growth.")
  else if (!week_valid) warnings <- c(warnings, "Ending week must be a whole number 1-42, or blank. No interval was substituted.")
  else if (is.null(row)) warnings <- c(warnings, "No growth norms for this exact subject, grades and weeks. Valid achievement timepoints remain available.")
  if (include_actual && nzchar(end_text) && is.na(actual_score)) warnings <- c(warnings, "Ending RIT must be a number 100-300, or blank. Forecast remains available; actual results are omitted.")
  if (start$withheld || end$withheld) warnings <- c(warnings, "Mathematics/Reading grade 12 achievement statistics are withheld pending source review. Valid growth results remain available.")
  if (is.na(start$mean) && !start$withheld) warnings <- c(warnings, "Starting achievement norms are unavailable for this subject, grade and week.")
  if (week_valid && is.na(end$mean) && !end$withheld) warnings <- c(warnings, "Ending achievement norms are unavailable for this subject, grade and week.")
  if (growth_available && is.na(actual_score)) warnings <- c(warnings, "Forecast only. An actual ending RIT is needed for observed growth, CGI, CGP and ending achievement percentile.")
  structure(list(inputs = list(subject = subject, subject_label = unname(labels[subject]), start_grade = start_grade,
    end_grade = end_grade, start_week = start_week, end_week = end_week_value,
    start_rit = start_score, end_rit = actual_score, include_actual = include_actual),
    achievement = list(start = start, end = end), growth = growth,
    growth_available = growth_available, warnings = unique(warnings),
    source = list(growth_row = if (is.null(row)) NA_integer_ else row$SourceRow,
      growth_sheet = if (is.null(row)) NA_character_ else row$SourceSheet,
      parameters = if (is.null(row)) NULL else row[c("P1", "P2", "V11", "V12", "V21", "V22")],
      parameter_workbook_sha256 = norms$provenance$ParameterWorkbookSHA256)), class = "asg_result")
}

asg_results_table <- function(result) {
  s <- result$achievement$start; e <- result$achievement$end; g <- result$growth
  data.frame(metric = c("Starting achievement mean", "Starting achievement SD", "Starting achievement percentile",
    "Ending achievement mean", "Ending achievement SD", "Ending achievement percentile",
    "Conditional Growth Projection", "Projected ending RIT", "SD of Growth", "Observed Growth", "CGI", "CGP"),
    value = c(s$mean, s$sd, s$percentile, e$mean, e$sd, e$percentile,
      g$conditional_projection, g$projected_ending_rit, g$conditional_sd, g$observed, g$cgi, g$cgp),
    stringsAsFactors = FALSE)
}

print.asg_result <- function(x, ...) {
  cat("ASG calculator | 2025 student norms | M05 percentile method\n")
  print(asg_results_table(x), row.names = FALSE)
  if (length(x$warnings)) cat("\n", paste(x$warnings, collapse = "\n"), "\n", sep = "")
  invisible(x)
}
