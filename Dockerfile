# Stage 1: Build frontend with modern Node
FROM node:20 AS build-frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Runtime with R + Node
FROM rocker/r-ver:4.4.0

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node from nodesource (modern version)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install R packages for RStudent
RUN R -e "install.packages(c('rmarkdown', 'knitr', 'ggplot2', 'dplyr', 'tidyr', 'shiny', 'jsonlite', 'base64enc'), repos='https://cloud.r-project.org')" \
    && R -e "tinytex::install_tinytex(force=TRUE)" 2>/dev/null || true

# Copy built frontend and server
COPY --from=build-frontend /app/dist /app/dist
COPY server.js /app/server.js

WORKDIR /app

EXPOSE 80

CMD node server.js
