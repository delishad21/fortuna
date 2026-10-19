# Production Dockerfile for the Python file-parser service (also runs the
# parser sandbox worker)
FROM python:3.11-slim AS deps

# Install Python dependencies into a prefix the final stage copies
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim AS runner

WORKDIR /app

# Install system dependencies for pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /install /usr/local

# Copy application code
COPY app/ ./app/

# Expose port
EXPOSE 4000

# Run the Flask application
CMD ["python", "-m", "flask", "--app", "app.main", "run", "--host", "0.0.0.0", "--port", "4000"]
