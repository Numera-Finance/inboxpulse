/**
 * Escalation Batch Email Template
 * Sends a summary of all open escalations to managers
 */

import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Tailwind,
} from "@react-email/components";
import * as React from "react";

export interface EscalationItem {
  id: string;
  customer: string;
  subject: string;
  dateOpened: string;
  assignedTo: string;
  accountOwner: string;
  detailsUrl: string;
}

export interface EscalationMetrics {
  new: number;
  open1Day: number;
  open3Days: number;
  openMoreThan3Days: number;
}

export interface EscalationBatchEmailProps {
  escalations: EscalationItem[];
  metrics: EscalationMetrics;
  recipientName?: string;
}

export function EscalationBatchEmail({
  escalations,
  metrics,
  recipientName,
}: EscalationBatchEmailProps) {
  const totalEscalations =
    metrics.new + metrics.open1Day + metrics.open3Days + metrics.openMoreThan3Days;
  const previewText = `${totalEscalations} escalation${totalEscalations !== 1 ? "s" : ""} require attention`;

  const isSamePerson = (assignedTo: string, accountOwner: string) =>
    assignedTo.toLowerCase().trim() === accountOwner.toLowerCase().trim();

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container
            className="bg-white mx-auto my-10 max-w-[540px] rounded-xl overflow-hidden"
            style={{ border: '1px solid #e4e4e7' }}
          >
            {/* Header */}
            <Section className="bg-zinc-900 px-8 py-7">
              <Text className="text-red-400 text-xs font-medium uppercase tracking-wider m-0 mb-2">
                Action Required
              </Text>
              <Text className="text-white text-[22px] font-semibold m-0">
                Escalation Summary
              </Text>
            </Section>

            {/* Metrics Cards */}
            <Section className="px-8 pt-6 pb-2">
              <table width="100%" cellPadding={0} cellSpacing={0}>
                <tr>
                  {/* New */}
                  <td width="25%" style={{ paddingRight: "6px" }}>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                      <Text className="text-2xl font-bold text-blue-600 m-0">
                        {metrics.new}
                      </Text>
                      <Text className="text-[10px] font-medium text-blue-700 uppercase tracking-wide m-0 mt-1">
                        New
                      </Text>
                    </div>
                  </td>

                  {/* Open 1 Day */}
                  <td width="25%" style={{ paddingRight: "6px", paddingLeft: "6px" }}>
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-center">
                      <Text className="text-2xl font-bold text-amber-600 m-0">
                        {metrics.open1Day}
                      </Text>
                      <Text className="text-[10px] font-medium text-amber-700 uppercase tracking-wide m-0 mt-1">
                        1 Day
                      </Text>
                    </div>
                  </td>

                  {/* Open 3 Days */}
                  <td width="25%" style={{ paddingRight: "6px", paddingLeft: "6px" }}>
                    <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 text-center">
                      <Text className="text-2xl font-bold text-orange-600 m-0">
                        {metrics.open3Days}
                      </Text>
                      <Text className="text-[10px] font-medium text-orange-700 uppercase tracking-wide m-0 mt-1">
                        3 Days
                      </Text>
                    </div>
                  </td>

                  {/* Open 3+ Days */}
                  <td width="25%" style={{ paddingLeft: "6px" }}>
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-center">
                      <Text className="text-2xl font-bold text-red-600 m-0">
                        {metrics.openMoreThan3Days}
                      </Text>
                      <Text className="text-[10px] font-medium text-red-700 uppercase tracking-wide m-0 mt-1">
                        3+ Days
                      </Text>
                    </div>
                  </td>
                </tr>
              </table>
            </Section>

            {/* Divider */}
            <Section className="px-8 py-4">
              <div className="border-t border-zinc-200"></div>
            </Section>

            {/* Escalation List */}
            <Section className="px-8 pb-6">
              <Text className="text-xs font-medium text-zinc-400 uppercase tracking-wider m-0 mb-4">
                Recent Escalations
              </Text>

              {escalations.map((item, index) => (
                <div
                  key={item.id}
                  className={`p-5 rounded-lg bg-zinc-50 ${
                    index < escalations.length - 1 ? "mb-3" : ""
                  }`}
                  style={{ border: '1px solid #e4e4e7' }}
                >
                  <Link
                    href={item.detailsUrl}
                    className="text-lg font-semibold text-zinc-900 no-underline"
                  >
                    {item.customer} →
                  </Link>
                  <Text className="text-[15px] text-zinc-600 m-0 mt-1 mb-4 leading-snug">
                    {item.subject}
                  </Text>

                  {/* Details Grid */}
                  <table width="100%" cellPadding={0} cellSpacing={0}>
                    <tr>
                      <td width="50%" valign="top" style={{ paddingRight: "12px" }}>
                        <Text className="text-[10px] text-zinc-400 uppercase tracking-wide m-0 mb-1">
                          Opened
                        </Text>
                        <Text className="text-sm text-zinc-700 font-medium m-0">
                          {item.dateOpened}
                        </Text>
                      </td>
                      <td width="50%" valign="top" style={{ paddingLeft: "12px" }}>
                        <Text className="text-[10px] text-zinc-400 uppercase tracking-wide m-0 mb-1">
                          Assigned To
                        </Text>
                        <Text className="text-sm text-zinc-700 font-medium m-0">
                          {item.assignedTo}
                        </Text>
                      </td>
                    </tr>
                    {!isSamePerson(item.assignedTo, item.accountOwner) && (
                      <tr>
                        <td
                          colSpan={2}
                          style={{ paddingTop: "12px" }}
                          valign="top"
                        >
                          <Text className="text-[10px] text-zinc-400 uppercase tracking-wide m-0 mb-1">
                            Account Owner
                          </Text>
                          <Text className="text-sm text-zinc-700 font-medium m-0">
                            {item.accountOwner}
                          </Text>
                        </td>
                      </tr>
                    )}
                  </table>
                </div>
              ))}
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default EscalationBatchEmail;
