FROM public.ecr.aws/docker/library/python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LOCUST_USERS=10 \
    LOCUST_SPAWN_RATE=1

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY locustfile.py .

RUN useradd --uid 10001 --no-create-home locust
USER 10001

# Headless and with no run time, so it generates traffic until the task stops
CMD ["sh", "-c", "exec locust -f locustfile.py --headless --only-summary --users \"$LOCUST_USERS\" --spawn-rate \"$LOCUST_SPAWN_RATE\" --loglevel INFO"]
