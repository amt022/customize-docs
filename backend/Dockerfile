# Hosted FormEasy server. Build from the project root:  docker build -f backend/Dockerfile -t formeasy .
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-hin fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt boto3==1.43.123 "psycopg[binary,pool]==3.3.7"
COPY backend/pdfmaster ./pdfmaster
COPY --from=web /web/dist /app/web/dist
ENV PDFMASTER_DATA=/tmp/formeasy \
    PDFMASTER_WEB=/app/web/dist \
    PDFMASTER_MULTIUSER=1 \
    PDFMASTER_RETENTION_HOURS=24 \
    PDFMASTER_STORAGE=s3 \
    PDFMASTER_SMS=msg91 \
    PDFMASTER_CORS=""
RUN useradd -m formeasy
USER formeasy
EXPOSE 8000
CMD ["uvicorn", "pdfmaster.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
