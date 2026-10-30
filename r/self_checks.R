# self_checks.R
# Purpose: Run independent pinned M01/M02/M05 regression cases in browser R.
# This checks the actual R runtime, never a JavaScript numerical substitute.
# Owner: Nil Shah and Codex. Updated: 2026-10-30.
run_browser_self_checks <- function(norms) {
checks <- list()
check <- function(name, passed) {
  checks[[length(checks) + 1]] <<- data.frame(check = name, passed = isTRUE(passed))
}
near <- function(actual, expected, tolerance = 1e-9) {
  (is.na(actual) && is.na(expected)) || (!is.na(actual) && !is.na(expected) && abs(actual - expected) <= tolerance)
}

# ---- Independent pre-existing golden results ------------------------------
fixtures <- read.csv("/app/data/golden_cases.csv", colClasses = "character", na.strings = "", check.names = FALSE)
for (j in seq_len(nrow(fixtures))) {
  f <- fixtures[j, ]
  r <- calculate_asg(norms, f$subject, f$start_grade, f$end_grade, f$start_week,
    ifelse(is.na(f$end_week), "", f$end_week), f$start_rit,
    ifelse(is.na(f$end_rit), "", f$end_rit), f$include_actual == "True")
  s <- r$achievement$start; e <- r$achievement$end; g <- r$growth
  actual <- c(start_mean = s$mean, start_sd = s$sd, start_percentile_raw = s$percentile_raw,
    start_percentile = s$percentile, end_mean = e$mean, end_sd = e$sd,
    end_percentile_raw = e$percentile_raw, end_percentile = e$percentile,
    conditional_projection = g$conditional_projection, conditional_sd = g$conditional_sd,
    projected_ending_RIT = g$projected_ending_rit, observed_gain = g$observed,
    CGI = g$cgi, CGP_raw = g$cgp_raw, CGP = g$cgp, grade_average_growth_P2 = g$grade_average_growth)
  for (name in names(actual)) check(paste(f$id, name), near(actual[[name]], as.numeric(f[[name]])))
}

# ---- Methods, data shape and important non-default cases ------------------
check("unique growth keys", length(unique(norms$growth_key)) == 75720)
check("independent status keys", length(unique(norms$status_key)) == 1848)
check("grade 12 quarantine count", sum(norms$status$WithholdStatus) == 84)
check("M05 mean and tails", identical(m05_percentile(c(-Inf, 0, Inf)), c(0, 50, 100)))
check("M05 missingness", all(is.na(m05_percentile(c(NA_real_, NaN)))))
check("positive half-up display and clamps", identical(display_percentile(c(0, 1.5, 50.5, 100)), c(1, 2, 51, 99)))
boundary <- calculate_asg(norms, end_rit = "169.34")
check("M05 vs pnorm CGP boundary", boundary$growth$cgp == 1 && boundary$growth$pnorm_percentile == 2)
boundary <- calculate_asg(norms, end_rit = "175.87")
check("M05 vs pnorm ending boundary", boundary$achievement$end$percentile == 1 && boundary$achievement$end$pnorm_percentile == 2)
boundary <- calculate_asg(norms, "math", 1, 1, 4, "32", 135, "")
check("M05 vs pnorm starting boundary", boundary$achievement$start$percentile == 4 && boundary$achievement$start$pnorm_percentile == 3)
starting_only <- calculate_asg(norms, end_week = "", end_rit = "")
check("blank week preserves starting status", starting_only$achievement$start$percentile == 4 && is.na(starting_only$achievement$end$mean) && !starting_only$growth_available)
for (week in c("32.0", "32.5", "0", "43", "foo", "1e1", "01")) {
  r <- calculate_asg(norms, end_week = week)
  check(paste("malformed week", week), !r$growth_available && !is.na(r$achievement$start$mean) && is.na(r$achievement$end$mean))
}
forecast <- calculate_asg(norms, end_rit = "")
check("blank actual retains projection and ending distribution", forecast$growth_available && is.na(forecast$growth$observed) && !is.na(forecast$achievement$end$mean))
forecast <- calculate_asg(norms, end_rit = "not a score", include_actual = FALSE)
check("forecast mode ignores actual text", forecast$growth_available && is.na(forecast$growth$observed))
partial <- calculate_asg(norms, start_rit = 99)
check("invalid start retains both norm distributions and ending percentile", is.na(partial$achievement$start$percentile) && !is.na(partial$achievement$start$mean) && partial$achievement$end$percentile == 31 && !partial$growth_available)
unsupported <- calculate_asg(norms, "lang", 10, 10, 40, "42", 230, "240")
check("status key absent from growth remains available", !unsupported$growth_available && !is.na(unsupported$achievement$start$mean) && !is.na(unsupported$achievement$end$percentile))
unsupported <- calculate_asg(norms, end_grade = 8)
check("no nearest grade fallback", !unsupported$growth_available && !is.na(unsupported$achievement$end$mean))
between <- calculate_asg(norms, "read", 6, 7, 4, "4", 180, "190")
check("same week between-year growth has no zero-interval division", between$growth_available && is.finite(between$growth$cgi))
grade12 <- calculate_asg(norms, "math", 11, 12, 4, "4", 210, "220")
check("grade 11 to 12 growth retained and ending status quarantined", grade12$growth_available && grade12$achievement$end$withheld && is.na(grade12$achievement$end$mean) && is.finite(grade12$growth$cgi))
adjusted <- calculate_asg(norms, start_rit = 200)
check("starting-score adjustment changes projection", abs(adjusted$growth$conditional_projection - 4.317073625) < 0.001 && abs(adjusted$growth$grade_average_growth - 3.094) < 1e-10)

  records <- lapply(checks, function(row) list(name = row$check[[1]], passed = row$passed[[1]]))
  list(passed = sum(vapply(records, function(row) row$passed, logical(1))),
    total = length(records), all_passed = all(vapply(records, function(row) row$passed, logical(1))),
    independent_numeric_comparisons = 192L,
    golden_scenarios = nrow(fixtures), checks = records)
}
