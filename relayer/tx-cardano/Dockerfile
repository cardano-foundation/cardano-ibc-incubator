# Start from the latest Node.js base image
FROM node:latest

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json for npm install
COPY ./package*.json ./

# Install dependencies based on the package.json files
RUN npm install

# Copy the rest of the application's source code to the container
COPY . .

# Expose port 4884 to the outside once the container has launched
EXPOSE 4884

# Define the command to run the application
CMD ["npm", "run", "start"]
