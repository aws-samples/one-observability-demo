# syntax=docker/dockerfile:1

FROM --platform=linux/amd64 python:3.8-slim-buster

WORKDIR /app

COPY requirements.txt requirements.txt
RUN pip3 install -r requirements.txt

COPY . .
ENV FLASK_APP=petfood

ENV EVIDENTLY_PROJECT=petfood

CMD [ "python3", "-m" , "gunicorn", "-w", "4", "-b", "0.0.0.0:5000", "--capture-output", "petfood:app"]
