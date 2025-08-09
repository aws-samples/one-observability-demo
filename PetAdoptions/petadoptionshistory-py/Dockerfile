# syntax=docker/dockerfile:1

FROM public.ecr.aws/docker/library/python:3.8.20-bullseye

WORKDIR /app

# prerequisites for building psycopg2
RUN apt-get update && apt-get install -y build-essential python3-dev libpq-dev

COPY requirements.txt requirements.txt
RUN pip3 install -r requirements.txt

COPY . .
ENV FLASK_APP=petadoptionshistory
ENV PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python

CMD [ "flask", "run" , "--host=0.0.0.0", "--port=8080"]

EXPOSE 8080/tcp