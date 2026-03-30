FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
# We use ts-node to run the server in dev, but for prod usually it's compiled or run via ts-node directly
# Since 'npm run start' handles ts-node (assuming it's installed or in package.json)
CMD ["npm", "start"]
