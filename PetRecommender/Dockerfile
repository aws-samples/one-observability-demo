# Use a Python base image
FROM python:3.9-slim

# Copy the HTML file to the container
COPY index.html /app/index.html
COPY PetRecommender_1.png /app/PetRecommender_1.png
COPY bootstrap.min.css /app/bootstrap.min.css
COPY brand.png /app/brand.png
COPY main_banner.png /app/main_banner.png
COPY main_banner_text.png /app/main_banner_text.png
COPY petstyles.css /app/petstyles.css

# Expose the port for the HTTP server
EXPOSE 8080

# Start the HTTP server when the container runs
CMD ["python", "-m", "http.server", "8080", "--directory", "/app"]
