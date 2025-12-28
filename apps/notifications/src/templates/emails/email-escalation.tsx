/**
 * Email Escalation Notification Template
 * Sent when an email needs attention/escalation
 */

import {
  Button,
  Heading,
  Section,
  Text,
  Row,
  Column,
} from '@react-email/components';
import * as React from 'react';
import { BaseLayout } from './base-layout';

export interface EmailEscalationProps {
  recipientName: string;
  customerName: string;
  emailSubject: string;
  severity: 'low' | 'medium' | 'high' | 'urgent';
  reason: string;
  waitingHours?: number;
  viewUrl: string;
  approveUrl?: string;
  rejectUrl?: string;
  unsubscribeUrl?: string;
}

const severityColors = {
  low: '#3498db',
  medium: '#f39c12',
  high: '#e74c3c',
  urgent: '#8e44ad',
};

const severityLabels = {
  low: 'Low Priority',
  medium: 'Medium Priority',
  high: 'High Priority',
  urgent: 'Urgent',
};

export function EmailEscalation({
  recipientName,
  customerName,
  emailSubject,
  severity,
  reason,
  waitingHours,
  viewUrl,
  approveUrl,
  rejectUrl,
  unsubscribeUrl,
}: EmailEscalationProps) {
  const severityColor = severityColors[severity] || severityColors.medium;
  const severityLabel = severityLabels[severity] || severity;

  return (
    <BaseLayout
      preview={`Action needed: ${emailSubject} from ${customerName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={styles.heading}>Email Needs Your Attention</Heading>

      <Text style={styles.greeting}>Hi {recipientName},</Text>

      <Text style={styles.text}>
        An email from <strong>{customerName}</strong> requires your attention.
      </Text>

      {/* Severity Badge */}
      <Section style={{ ...styles.badge, backgroundColor: severityColor }}>
        <Text style={styles.badgeText}>{severityLabel}</Text>
      </Section>

      {/* Email Details */}
      <Section style={styles.detailsBox}>
        <Row>
          <Column>
            <Text style={styles.label}>Subject</Text>
            <Text style={styles.value}>{emailSubject}</Text>
          </Column>
        </Row>
        <Row>
          <Column>
            <Text style={styles.label}>From</Text>
            <Text style={styles.value}>{customerName}</Text>
          </Column>
        </Row>
        <Row>
          <Column>
            <Text style={styles.label}>Reason</Text>
            <Text style={styles.value}>{reason}</Text>
          </Column>
        </Row>
        {waitingHours && (
          <Row>
            <Column>
              <Text style={styles.label}>Waiting</Text>
              <Text style={styles.value}>{waitingHours} hours</Text>
            </Column>
          </Row>
        )}
      </Section>

      {/* Action Buttons */}
      <Section style={styles.buttonRow}>
        <Button href={viewUrl} style={styles.primaryButton}>
          View Email
        </Button>
      </Section>

      {approveUrl && rejectUrl && (
        <Section style={styles.buttonRow}>
          <Row>
            <Column align="center">
              <Button href={approveUrl} style={styles.approveButton}>
                Approve
              </Button>
            </Column>
            <Column align="center">
              <Button href={rejectUrl} style={styles.rejectButton}>
                Reject
              </Button>
            </Column>
          </Row>
        </Section>
      )}
    </BaseLayout>
  );
}

const styles = {
  heading: {
    color: '#1a1a2e',
    fontSize: '24px',
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
    margin: '0 0 24px',
  },
  greeting: {
    color: '#333',
    fontSize: '16px',
    lineHeight: '24px',
    margin: '0 0 16px',
  },
  text: {
    color: '#333',
    fontSize: '16px',
    lineHeight: '24px',
    margin: '0 0 16px',
  },
  badge: {
    borderRadius: '4px',
    padding: '8px 16px',
    display: 'inline-block',
    margin: '0 0 24px',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    margin: 0,
    textTransform: 'uppercase' as const,
  },
  detailsBox: {
    backgroundColor: '#f6f9fc',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '24px',
  },
  label: {
    color: '#8898aa',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    textTransform: 'uppercase' as const,
    margin: '0 0 4px',
  },
  value: {
    color: '#1a1a2e',
    fontSize: '14px',
    margin: '0 0 12px',
  },
  buttonRow: {
    textAlign: 'center' as const,
    marginBottom: '16px',
  },
  primaryButton: {
    backgroundColor: '#1a1a2e',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    textAlign: 'center' as const,
    padding: '12px 24px',
  },
  approveButton: {
    backgroundColor: '#27ae60',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    padding: '10px 20px',
    marginRight: '8px',
  },
  rejectButton: {
    backgroundColor: '#e74c3c',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    padding: '10px 20px',
    marginLeft: '8px',
  },
};

export default EmailEscalation;
