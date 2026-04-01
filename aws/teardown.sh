#!/bin/bash
# cfref EC2 proxy teardown
# Run: bash teardown.sh

set -e

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_NAME="cfref-proxy"
SG_NAME="cfref-proxy-sg"
KEY_NAME="cfref-proxy-key"

echo "=== cfref EC2 Proxy Teardown ==="

# Find and terminate instance
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running,stopped" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text \
  --region "$REGION" 2>/dev/null || echo "None")

if [ "$INSTANCE_ID" != "None" ] && [ -n "$INSTANCE_ID" ]; then
  echo "Terminating instance: $INSTANCE_ID"
  aws ec2 terminate-instances --instance-ids "$INSTANCE_ID" --region "$REGION"
  aws ec2 wait instance-terminated --instance-ids "$INSTANCE_ID" --region "$REGION"
  echo "Instance terminated."
fi

# Delete security group
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=$SG_NAME" \
  --query "SecurityGroups[0].GroupId" \
  --output text \
  --region "$REGION" 2>/dev/null || echo "None")

if [ "$SG_ID" != "None" ] && [ -n "$SG_ID" ]; then
  echo "Deleting security group: $SG_ID"
  aws ec2 delete-security-group --group-id "$SG_ID" --region "$REGION" 2>/dev/null || echo "Could not delete SG (may have dependencies)"
fi

# Delete key pair
echo "Deleting key pair..."
aws ec2 delete-key-pair --key-name "$KEY_NAME" --region "$REGION" 2>/dev/null || true
rm -f "${KEY_NAME}.pem"

echo ""
echo "=== Teardown Complete ==="
