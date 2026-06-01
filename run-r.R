#!/usr/bin/env Rscript
# RStudent R runner - reads JSON from stdin, writes JSON to stdout
# Used by the Node.js API server

library(jsonlite)
library(base64enc)

# Read input
args <- commandArgs(trailingOnly = TRUE)
if (length(args) > 0) {
    input <- list(code = paste(readLines(args[1]), collapse = "\n"))
} else {
    input <- fromJSON(stdin())
}

action <- input$action %||% "execute"
code <- input$code %||% ""
plots_dir <- input$plots_dir %||% tempdir()

# Create plots dir
dir.create(plots_dir, showWarnings = FALSE, recursive = TRUE)

# Enable graphics
options(device = function(...) {
    png(filename = tempfile("rstudent_plot_", fileext = ".png"),
        width = 800, height = 600, res = 90)
})

result <- list()

if (action == "execute") {
    # Execute R code
    stdout_output <- capture.output({
        messages <- capture.output({
            tryCatch({
                eval(parse(text = code), envir = .GlobalEnv)
            }, error = function(e) {
                cat("Error: ", conditionMessage(e), "\n")
            }, warning = function(w) {
                cat("Warning: ", conditionMessage(w), "\n")
            })
        }, type = "message")
    }, type = "output")

    # Close graphics devices
    while (dev.cur() > 1) dev.off()

    # Copy plots
    plot_files <- list.files(tempdir(), pattern = "^rstudent_plot_.*\\.png$", full.names = TRUE)
    plots_data <- list()
    for (f in plot_files) {
        dest <- file.path(plots_dir, basename(f))
        file.copy(f, dest, overwrite = TRUE)
        plots_data[[length(plots_data) + 1]] <- list(
            name = basename(f),
            path = dest
        )
    }

    result$output <- paste(c(stdout_output, messages), collapse = "\n")
    result$plots <- plots_data

} else if (action == "knit") {
    # Knit RMarkdown
    tmp_rmd <- tempfile(fileext = ".Rmd")
    writeLines(code, tmp_rmd)

    log_output <- capture.output({
        tryCatch({
            pdf_path <- rmarkdown::render(tmp_rmd, output_format = "pdf_document", quiet = TRUE)
            result$pdf <- pdf_path
        }, error = function(e) {
            result$error <- conditionMessage(e)
        })
    }, type = "message")

    result$log <- paste(log_output, collapse = "\n")
    unlink(tmp_rmd)

} else if (action == "env") {
    vars <- ls(.GlobalEnv)
    env_list <- list()
    for (v in vars) {
        obj <- get(v, envir = .GlobalEnv)
        cls <- class(obj)[1]
        desc <- ""
        if (is.data.frame(obj)) {
            desc <- sprintf("(%d obs, %d vars)", nrow(obj), ncol(obj))
        } else if (is.matrix(obj)) {
            desc <- sprintf("(%d x %d)", nrow(obj), ncol(obj))
        } else if (is.list(obj)) {
            desc <- sprintf("(list, %d)", length(obj))
        } else if (is.function(obj)) {
            desc <- "(function)"
        } else {
            val <- tryCatch(format(obj)[1], error = function(e) "?")
            desc <- val
        }
        env_list[[length(env_list) + 1]] <- list(name = v, type = cls, value = desc)
    }
    result$environment <- env_list

} else if (action == "packages") {
    pkgs <- installed.packages(priority = "NA")
    pkg_list <- list()
    for (i in 1:nrow(pkgs)) {
        pkg_list[[length(pkg_list) + 1]] <- list(
            name = pkgs[i, "Package"],
            version = pkgs[i, "Version"]
        )
    }
    result$packages <- pkg_list

} else if (action == "plots") {
    plot_files <- list.files(plots_dir, pattern = "\\.png$", full.names = TRUE)
    plots_data <- list()
    for (f in sort(plot_files, decreasing = TRUE)) {
        # Read as base64
        hex <- readBin(f, "raw", file.info(f)$size)
        b64 <- base64encode(hex)
        plots_data[[length(plots_data) + 1]] <- list(
            name = basename(f),
            path = f,
            data_url = paste0("data:image/png;base64,", b64)
        )
    }
    result$plots <- plots_data
}

# Output as JSON
cat(toJSON(result, auto_unbox = TRUE))
