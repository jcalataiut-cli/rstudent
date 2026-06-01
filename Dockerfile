# Stage 1: Build frontend with modern Node
FROM node:20 AS build-frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Runtime with R + nginx
FROM rocker/r-ver:4.4.0

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc \
    curl \
    nginx \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Node from nodesource (modern version)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install R packages for RStudent
RUN R -e "install.packages(c('rmarkdown', 'knitr', 'ggplot2', 'dplyr', 'tidyr', 'shiny', 'jsonlite', 'base64enc'), repos='https://cloud.r-project.org')" \
    && R -e "tinytex::install_tinytex(force=TRUE)" 2>/dev/null || true

# Copy built frontend from stage 1
COPY --from=build-frontend /app/dist /app/dist
COPY --from=build-frontend /app/server.js /app/server.js

# Nginx: serve dist/ + proxy /api to Node.js
RUN { \
    echo 'server {'; \
    echo '    listen 80;'; \
    echo '    root /app/dist;'; \
    echo '    index index.html;'; \
    echo '    location / {'; \
    echo '        try_files $uri $uri/ /index.html;'; \
    echo '    }'; \
    echo '    location /api/ {'; \
    echo '        proxy_pass http://127.0.0.1:3001;'; \
    echo '        proxy_http_version 1.1;'; \
    echo '        proxy_set_header Upgrade $http_upgrade;'; \
    echo '        proxy_set_header Connection "upgrade";'; \
    echo '        proxy_set_header Host $host;'; \
    echo '    }'; \
    echo '}'; \
    } > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD nginx && node /app/server.js
