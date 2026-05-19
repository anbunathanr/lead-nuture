#!/bin/bash
# ============================================================
# Nurturio — AWS Serverless Deployment Script
# Uses: Lambda, API Gateway, DynamoDB, S3, CloudFront, SSM
# NO: EC2, RDS, VPC, NAT, Load Balancers
# ============================================================

set -e

STACK_NAME="${STACK_NAME:-nurturio}"
REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
DEPLOY_BUCKET="nurturio-deploy-${ACCOUNT_ID}"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     Nurturio Serverless Deploy       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Stack    : $STACK_NAME"
echo "  Region   : $REGION"
echo "  Account  : $ACCOUNT_ID"
echo "  Env      : $ENVIRONMENT"
echo ""

# Step 1 — Create deployment bucket if needed
echo "📦 Step 1: Ensuring deployment bucket..."
aws s3 mb s3://$DEPLOY_BUCKET --region $REGION 2>/dev/null || true

# Step 2 — Install Lambda dependencies
echo "📦 Step 2: Installing Lambda dependencies..."
cd lambda
npm install --production --silent
cd ..

# Step 3 — Copy shared AI modules into lambda folder
echo "📦 Step 3: Copying AI modules to Lambda..."
cp ai/bedrock-client.js lambda/bedrock-client.js

# Step 4 — SAM build and package
echo "🔨 Step 4: Building SAM package..."
sam build \
  --template-file infrastructure/template.yaml \
  --build-dir .aws-sam/build \
  --region $REGION

sam package \
  --template-file .aws-sam/build/template.yaml \
  --s3-bucket $DEPLOY_BUCKET \
  --output-template-file infrastructure/packaged.yaml \
  --region $REGION

# Step 5 — Deploy CloudFormation stack
echo "🚀 Step 5: Deploying stack..."
sam deploy \
  --template-file infrastructure/packaged.yaml \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_IAM \
  --region $REGION \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    AdminPassword="${ADMIN_PASSWORD:-nurturio-admin-2024}" \
    BedrockModelId="${BEDROCK_MODEL_ID:-us.anthropic.claude-haiku-4-5-20251001-v1:0}" \
    Environment="$ENVIRONMENT"

# Step 6 — Get stack outputs
echo "📋 Step 6: Getting stack outputs..."
STATIC_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='StaticBucketName'].OutputValue" \
  --output text --region $REGION)

API_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text --region $REGION)

CF_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" \
  --output text --region $REGION)

# Step 7 — Upload static files to S3
echo "🌐 Step 7: Uploading static files..."
aws s3 sync public/ s3://$STATIC_BUCKET/ \
  --delete \
  --exclude "*.DS_Store" \
  --region $REGION

# Step 8 — Store secrets in SSM (if provided as env vars)
echo "🔐 Step 8: Storing secrets in SSM..."
store_secret() {
  local name=$1 value=$2
  if [ -n "$value" ]; then
    aws ssm put-parameter \
      --name "/nurturio/$name" \
      --value "$value" \
      --type SecureString \
      --overwrite \
      --region $REGION 2>/dev/null && echo "  ✓ /nurturio/$name"
  fi
}

store_secret "aws-access-key"   "$AWS_ACCESS_KEY_ID"
store_secret "aws-secret-key"   "$AWS_SECRET_ACCESS_KEY"
store_secret "lead-bot-token"   "$LEAD_BOT_TOKEN"
store_secret "admin-password"   "$ADMIN_PASSWORD"
store_secret "bedrock-model-id" "$BEDROCK_MODEL_ID"

# Step 9 — Register Telegram webhook if bot token set
if [ -n "$LEAD_BOT_TOKEN" ] && [ -n "$CF_URL" ]; then
  echo "🤖 Step 9: Registering Telegram webhook..."
  curl -s "https://api.telegram.org/bot${LEAD_BOT_TOKEN}/setWebhook" \
    -d "url=${CF_URL}/telegram/webhook" | python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✓ Webhook set' if r.get('ok') else '  ✗ ' + r.get('description',''))"
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║           Deploy Complete!           ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  🌐 App URL    : $CF_URL"
echo "  🔌 API URL    : $API_URL"
echo "  📦 S3 Static  : $STATIC_BUCKET"
echo ""
echo "  Next steps:"
echo "  1. Open $CF_URL to access your app"
echo "  2. Go to $CF_URL/admin/login.html for admin panel"
echo "  3. Update n8n workflows to use API URL: $API_URL"
echo ""
