/**
 * Deal Won Notification Template
 * Sent when a deal is marked as won
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

export interface DealWonProps {
  recipientName: string;
  dealName: string;
  customerName: string;
  dealValue: string;
  currency?: string;
  closedBy: string;
  closedDate: string;
  viewUrl: string;
  celebrationMessage?: string;
  unsubscribeUrl?: string;
}

export function DealWon({
  recipientName,
  dealName,
  customerName,
  dealValue,
  currency = 'USD',
  closedBy,
  closedDate,
  viewUrl,
  celebrationMessage,
  unsubscribeUrl,
}: DealWonProps) {
  return (
    <BaseLayout
      preview={`Deal won: ${dealName} - ${currency} ${dealValue}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      {/* Celebration Header */}
      <Section style={styles.celebrationBanner}>
        <Text style={styles.celebrationEmoji}>🎉</Text>
        <Heading style={styles.heading}>Deal Won!</Heading>
      </Section>

      <Text style={styles.greeting}>Hi {recipientName},</Text>

      <Text style={styles.text}>
        Great news! A deal has been successfully closed.
      </Text>

      {celebrationMessage && (
        <Text style={styles.celebrationText}>{celebrationMessage}</Text>
      )}

      {/* Deal Details */}
      <Section style={styles.detailsBox}>
        <Row>
          <Column>
            <Text style={styles.label}>Deal</Text>
            <Text style={styles.value}>{dealName}</Text>
          </Column>
        </Row>
        <Row>
          <Column>
            <Text style={styles.label}>Customer</Text>
            <Text style={styles.value}>{customerName}</Text>
          </Column>
        </Row>
        <Row>
          <Column style={styles.valueColumn}>
            <Text style={styles.label}>Value</Text>
            <Text style={styles.dealValue}>
              {currency} {dealValue}
            </Text>
          </Column>
        </Row>
        <Row>
          <Column>
            <Text style={styles.label}>Closed By</Text>
            <Text style={styles.value}>{closedBy}</Text>
          </Column>
          <Column>
            <Text style={styles.label}>Closed Date</Text>
            <Text style={styles.value}>{closedDate}</Text>
          </Column>
        </Row>
      </Section>

      {/* Action Button */}
      <Section style={styles.buttonRow}>
        <Button href={viewUrl} style={styles.primaryButton}>
          View Deal Details
        </Button>
      </Section>
    </BaseLayout>
  );
}

const styles = {
  celebrationBanner: {
    textAlign: 'center' as const,
    marginBottom: '24px',
  },
  celebrationEmoji: {
    fontSize: '48px',
    margin: '0 0 8px',
  },
  heading: {
    color: '#27ae60',
    fontSize: '28px',
    fontWeight: 'bold' as const,
    textAlign: 'center' as const,
    margin: '0',
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
  celebrationText: {
    color: '#27ae60',
    fontSize: '16px',
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
    margin: '0 0 24px',
  },
  detailsBox: {
    backgroundColor: '#f6f9fc',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '24px',
    border: '2px solid #27ae60',
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
    margin: '0 0 16px',
  },
  valueColumn: {
    textAlign: 'center' as const,
  },
  dealValue: {
    color: '#27ae60',
    fontSize: '28px',
    fontWeight: 'bold' as const,
    margin: '0 0 16px',
  },
  buttonRow: {
    textAlign: 'center' as const,
  },
  primaryButton: {
    backgroundColor: '#27ae60',
    borderRadius: '4px',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    textDecoration: 'none',
    textAlign: 'center' as const,
    padding: '12px 24px',
  },
};

export default DealWon;
