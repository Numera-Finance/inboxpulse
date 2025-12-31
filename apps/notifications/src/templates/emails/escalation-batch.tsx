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
  escalations = [
    {
      id: "1",
      customer: "Acme Corp",
      subject: "Billing discrepancy on invoice #4521",
      dateOpened: "Dec 28, 2024",
      assignedTo: "John Smith",
      accountOwner: "Lisa Chen",
      detailsUrl: "https://app.example.com/tasks/1",
    },
    {
      id: "2",
      customer: "TechStart Inc",
      subject: "Integration API timeout issues",
      dateOpened: "Dec 27, 2024",
      assignedTo: "Sarah Johnson",
      accountOwner: "Sarah Johnson",
      detailsUrl: "https://app.example.com/tasks/2",
    },
    {
      id: "3",
      customer: "Global Logistics",
      subject: "Missing shipment documentation",
      dateOpened: "Dec 25, 2024",
      assignedTo: "Mike Chen",
      accountOwner: "Rachel Kim",
      detailsUrl: "https://app.example.com/tasks/3",
    },
  ],
  metrics = {
    new: 2,
    open1Day: 3,
    open3Days: 1,
    openMoreThan3Days: 4,
  },
  recipientName = "Team",
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
        <Body className="bg-gray-200 font-sans">
          <Container className="bg-white mx-auto my-10 max-w-[540px] rounded-xl overflow-hidden shadow-sm">
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
                <Link
                  key={item.id}
                  href={item.detailsUrl}
                  className={`block no-underline p-4 rounded-lg bg-zinc-50 border border-zinc-100 ${
                    index < escalations.length - 1 ? "mb-3" : ""
                  }`}
                >
                  <table width="100%" cellPadding={0} cellSpacing={0}>
                    <tr>
                      {/* Number badge */}
                      <td width="42" valign="top">
                        <div
                          className="w-7 h-7 bg-red-50 rounded-full text-center"
                          style={{ lineHeight: "28px" }}
                        >
                          <span className="text-xs font-semibold text-red-600">
                            {index + 1}
                          </span>
                        </div>
                      </td>

                      {/* Content */}
                      <td valign="top">
                        <Text className="text-[15px] font-semibold text-zinc-900 m-0 mb-1">
                          {item.customer}
                        </Text>
                        <Text className="text-sm text-zinc-600 m-0 mb-2.5 leading-snug">
                          {item.subject}
                        </Text>
                        <div className="text-xs text-zinc-500">
                          <Text className="m-0 mb-0.5">
                            <span className="text-zinc-400">Opened:</span>{" "}
                            {item.dateOpened}
                          </Text>
                          {isSamePerson(item.assignedTo, item.accountOwner) ? (
                            <Text className="m-0">
                              <span className="text-zinc-400">Assigned & Owner:</span>{" "}
                              {item.assignedTo}
                            </Text>
                          ) : (
                            <>
                              <Text className="m-0 mb-0.5">
                                <span className="text-zinc-400">Assigned:</span>{" "}
                                {item.assignedTo}
                              </Text>
                              <Text className="m-0">
                                <span className="text-zinc-400">Account Owner:</span>{" "}
                                {item.accountOwner}
                              </Text>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Chevron */}
                      <td width="24" valign="middle" align="right">
                        <span className="text-xl text-zinc-400">›</span>
                      </td>
                    </tr>
                  </table>
                </Link>
              ))}
            </Section>

            {/* Footer */}
            <Section className="px-8 py-5 bg-zinc-50 border-t border-zinc-100">
              <Text className="text-sm text-zinc-500 m-0 text-center">
                Click any item to view details and take action.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default EscalationBatchEmail;
