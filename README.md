# Quick Chat Backend

## Environment Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Configure the following variables in your `.env` file:

### Required for Basic Functionality:
- `MONGODB_URI`: Your MongoDB connection string
- `JWT_SECRET` and `JWT_REFRESH_SECRET`: Random strings for JWT tokens

### Optional Services (leave empty to disable):
- **Twilio SMS**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- **Email**: `EMAIL_USER`, `EMAIL_PASS` (Gmail app password)
- **File Uploads**: Cloudinary credentials
- **Payments**: PhonePe credentials
- **Push Notifications**: Firebase credentials

### Getting Twilio Credentials:
1. Sign up at [Twilio](https://www.twilio.com/)
2. Get your Account SID and Auth Token from the dashboard
3. Purchase or get a trial phone number for sending SMS

### Development Notes:
- The app will work without Twilio credentials (SMS will be logged but not sent)
- Email functionality requires Gmail app password setup
- MongoDB Atlas or local MongoDB instance required

## Running the Application

```bash
npm install
npm start
```

The server will start on port 5000 (configurable via PORT env variable).
