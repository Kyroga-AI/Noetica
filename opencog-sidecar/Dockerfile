FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt rdflib pyshacl
COPY . .
EXPOSE 8137
# Bind loopback by default — this sidecar is an unauthenticated local inference co-processor and must
# NOT be network-reachable. Operators who intentionally publish it (behind their own auth/network policy)
# can override with OPENCOG_HOST=0.0.0.0.
CMD ["sh", "-c", "uvicorn server:app --host ${OPENCOG_HOST:-127.0.0.1} --port 8137"]
