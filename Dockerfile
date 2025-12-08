FROM node:20-slim

# Установка системных зависимостей для Python и PDF парсинга
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    libpixman-1-dev \
    libfreetype6-dev \
    pkg-config \
    ghostscript \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Копируем package.json для установки Node.js зависимостей
COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force
# Удаляем CLI пакеты, они не нужны в продакшене
RUN npm remove @shopify/cli

# Создаём Python virtual environment
RUN python3 -m venv /app/python/venv

# Активируем venv и устанавливаем Python зависимости
COPY python/requirements.txt ./python/requirements.txt
RUN /app/python/venv/bin/pip install --upgrade pip && \
    /app/python/venv/bin/pip install --no-cache-dir -r python/requirements.txt

# Копируем весь проект
COPY . .

# Генерируем Prisma Client перед сборкой
RUN npx prisma generate

# Собираем приложение
RUN npm run build

# Создаём директории для локального хранилища (fallback если /data не доступен)
RUN mkdir -p /app/.local-storage/pdfs

# Устанавливаем переменную окружения для использования venv Python
ENV PATH="/app/python/venv/bin:$PATH"
ENV VIRTUAL_ENV="/app/python/venv"

CMD ["node", "./dbsetup.js", "npm", "run", "start"]
