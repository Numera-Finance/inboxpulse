# Analysis API Examples

## Endpoint

`POST /api/analysis/analyze`

## Request Body

```json
{
  "tenantId": "uuid-string",
  "email": {
    "provider": "gmail",
    "messageId": "unique-message-id",
    "threadId": "thread-id",
    "subject": "Email subject",
    "body": "Email body content",
    "from": {
      "email": "sender@example.com",
      "name": "Sender Name"
    },
    "tos": [
      {
        "email": "recipient@example.com",
        "name": "Recipient Name"
      }
    ],
    "ccs": [],
    "bccs": [],
    "receivedAt": "2024-01-15T10:30:00Z",
    "priority": "normal",
    "labels": []
  },
  "threadContext": "Optional: formatted thread history string",  // API service should build this
  "analysisTypes": ["sentiment", "escalation"],  // Which analyses to run
  "config": {  // Optional: override model configs, settings, etc.
    "modelConfigs": {
      "sentiment": {
        "primary": "gemini-3.5-flash",
        "fallback": "gpt-4o-mini"
      }
    }
  }
}
```

**Note:** The analysis service is stateless. The API service should:
- Fetch analysis config from database
- Build thread context if needed
- Pass everything in the request

## Available Analysis Types

You can specify any of these analysis types in the `analysisTypes` array:

- `sentiment` - Analyze emotional tone (positive/negative/neutral)
- `escalation` - Detect if email requires escalation
- `upsell` - Identify upsell opportunities
- `churn` - Assess customer churn risk
- `kudos` - Detect positive feedback and praise
- `competitor` - Detect mentions of competitors
- `signature-extraction` - Extract contact info from signature

**Note:** `domain-extraction` and `contact-extraction` are always-run analyses handled separately.

## Examples

### Example 1: Analyze with Specific Analysis Types

```bash
curl -X POST http://localhost:4002/api/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "123e4567-e89b-12d3-a456-426614174000",
    "email": {
      "provider": "gmail",
      "messageId": "msg-123",
      "threadId": "thread-456",
      "subject": "Customer Feedback",
      "body": "I am very happy with your service! The product exceeded my expectations.",
      "from": {
        "email": "customer@example.com",
        "name": "John Doe"
      },
      "tos": [
        {
          "email": "support@company.com",
          "name": "Support Team"
        }
      ],
      "ccs": [],
      "bccs": [],
      "receivedAt": "2024-01-15T10:30:00Z",
      "priority": "normal"
    },
    "analysisTypes": ["sentiment", "kudos"]
  }'
```

### Example 2: Use Tenant Config (All Enabled Analyses)

If you don't specify `analysisTypes`, it will use the tenant's enabled analyses from the database config:

```bash
curl -X POST http://localhost:4002/api/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "123e4567-e89b-12d3-a456-426614174000",
    "email": {
      "provider": "gmail",
      "messageId": "msg-123",
      "threadId": "thread-456",
      "subject": "Need Help Urgently",
      "body": "I am extremely frustrated and need to speak to a manager immediately. This is unacceptable!",
      "from": {
        "email": "angry@customer.com",
        "name": "Angry Customer"
      },
      "tos": [
        {
          "email": "support@company.com"
        }
      ],
      "ccs": [],
      "bccs": [],
      "receivedAt": "2024-01-15T10:30:00Z"
    }
  }'
```

### Example 3: With Thread Context

For analyses that require thread context (like `escalation` and `churn`), provide the `threadId`:

```bash
curl -X POST http://localhost:4002/api/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "123e4567-e89b-12d3-a456-426614174000",
    "email": {
      "provider": "gmail",
      "messageId": "msg-123",
      "threadId": "thread-456",
      "subject": "Re: Issue Not Resolved",
      "body": "This is the third time I am contacting you about this issue.",
      "from": {
        "email": "customer@example.com",
        "name": "Jane Smith"
      },
      "tos": [
        {
          "email": "support@company.com"
        }
      ],
      "ccs": [],
      "bccs": [],
      "receivedAt": "2024-01-15T10:30:00Z"
    },
    "threadId": "123e4567-e89b-12d3-a456-426614174001",
    "analysisTypes": ["escalation", "churn"]
  }'
```

### Example 4: Multiple Analyses

Run multiple analyses in a single request:

```bash
curl -X POST http://localhost:4002/api/analysis/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "123e4567-e89b-12d3-a456-426614174000",
    "email": {
      "provider": "gmail",
      "messageId": "msg-123",
      "threadId": "thread-456",
      "subject": "Product Inquiry",
      "body": "I am interested in upgrading to your premium plan. Also, I noticed your competitor XYZ offers similar features.",
      "from": {
        "email": "prospect@example.com",
        "name": "Prospect User"
      },
      "tos": [
        {
          "email": "sales@company.com"
        }
      ],
      "ccs": [],
      "bccs": [],
      "receivedAt": "2024-01-15T10:30:00Z"
    },
    "analysisTypes": ["sentiment", "upsell", "competitor"]
  }'
```

## Response Format

```json
{
  "success": true,
  "data": {
    "results": {
      "sentiment": {
        "value": "positive",
        "confidence": 0.9
      },
      "kudos": {
        "detected": true,
        "confidence": 0.85,
        "message": "Very happy with service",
        "category": "service"
      }
    }
  }
}
```

## Error Response

```json
{
  "success": false,
  "error": {
    "message": "Error message",
    "statusCode": 400
  }
}
```

## Notes

1. **Analysis Types**: If you specify `analysisTypes`, only those analyses will run (if enabled in tenant config). If omitted, all enabled analyses from tenant config will run.

2. **Thread Context**: Some analyses (`escalation`, `churn`) require thread context. Provide `threadId` in the request to enable these analyses.

3. **Batch Execution**: The framework automatically tries to batch multiple analyses into a single LLM call for efficiency, falling back to individual calls if batch fails.

4. **Model Fallback**: Each analysis has a primary model and optional fallback model. If primary fails, fallback is automatically used.

5. **Always-Run Analyses**: `domain-extraction` and `contact-extraction` are handled separately via their own endpoints (`/domain-extract` and `/contact-extract`).
