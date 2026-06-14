import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTaskClient } from '../lib/clients';
import { TaskStatus } from '@crm/clients';
import type { Task } from '@crm/clients';
import type { ThreadNegativeEmail } from '../hooks/useThreadCustomer';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface NegativeEmailResolutionProps {
  customerId: string;
  /** Negative-sentiment emails detected in the open thread. */
  negativeEmails: ThreadNegativeEmail[];
}

/**
 * When the open Gmail thread contains a negative-sentiment email, show a
 * prominent banner and the same resolution workflow as the web app: an
 * escalation task with a comment thread, where marking it resolved requires at
 * least one comment.
 */
export function NegativeEmailResolution({
  customerId,
  negativeEmails,
}: NegativeEmailResolutionProps): React.ReactElement | null {
  if (negativeEmails.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-destructive/20">
        <AlertTriangle size={14} className="text-destructive shrink-0" />
        <h3 className="text-xs font-semibold text-destructive">
          Negative email — resolution needed
        </h3>
      </div>
      <div className="divide-y divide-destructive/15">
        {negativeEmails.map((email) => (
          <NegativeEmailItem key={email.id} customerId={customerId} email={email} />
        ))}
      </div>
    </div>
  );
}

function NegativeEmailItem({
  customerId,
  email,
}: {
  customerId: string;
  email: ThreadNegativeEmail;
}): React.ReactElement {
  // Find the escalation task linked to this email. The server search can't filter
  // by emailId, so we pull the customer's tasks and match client-side.
  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['tasks', 'by-email', customerId, email.id],
    queryFn: async () => {
      const client = getTaskClient();
      const result = await client.search({
        customerId,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: 100,
      });
      return result.items.filter((task) => task.emailId === email.id);
    },
    staleTime: 30_000,
  });

  const openTask = tasks?.find((t) => t.status === TaskStatus.OPEN) ?? null;
  const doneTask = tasks?.find((t) => t.status === TaskStatus.DONE) ?? null;

  return (
    <div className="px-3 py-2.5 space-y-2">
      <p className="text-xs font-medium text-foreground truncate" title={email.subject}>
        {email.subject || '(no subject)'}
      </p>
      {email.receivedAt && (
        <p className="text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}
        </p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <Loader2 size={12} className="animate-spin" />
          Loading resolution…
        </div>
      ) : openTask ? (
        <ResolutionPanel task={openTask} />
      ) : doneTask ? (
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 size={12} />
          Resolved {formatDistanceToNow(new Date(doneTask.completedAt ?? doneTask.updatedAt), { addSuffix: true })}
        </div>
      ) : (
        <CreateResolution customerId={customerId} email={email} />
      )}
    </div>
  );
}

/**
 * Resolution UI for an open escalation task. Mirrors the web app's resolve flow:
 * marking a task done requires a structured problem + resolution (the API's
 * MarkDoneRequest), not a free-form comment.
 */
function ResolutionPanel({ task }: { task: Task }): React.ReactElement {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState('');
  const [resolution, setResolution] = useState('');

  const markDoneMutation = useMutation({
    mutationFn: async () =>
      getTaskClient().markDone(task.id, {
        problem: problem.trim(),
        resolution: resolution.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'by-email'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'customer', task.customerId] });
    },
  });

  const canResolve = problem.trim().length > 0 && resolution.trim().length > 0;

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={problem}
        onChange={(e) => setProblem(e.target.value)}
        placeholder="Problem…"
        className="w-full rounded border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <textarea
        value={resolution}
        onChange={(e) => setResolution(e.target.value)}
        placeholder="Resolution…"
        rows={2}
        className="w-full rounded border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
      />

      <button
        onClick={() => markDoneMutation.mutate()}
        disabled={!canResolve || markDoneMutation.isPending}
        title={canResolve ? 'Mark resolved' : 'Enter a problem and resolution first'}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-success/10 text-success hover:bg-success/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {markDoneMutation.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <CheckCircle2 size={12} />
        )}
        Mark resolved
      </button>

      {!canResolve && (
        <p className="text-[11px] text-muted-foreground">
          Enter a problem and resolution before marking resolved.
        </p>
      )}

      {markDoneMutation.error && (
        <p className="text-xs text-destructive">
          {(markDoneMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

/**
 * Fallback when a negative email has no escalation task yet (rare — the backend
 * auto-creates one during analysis). Lets the user open an escalation so they
 * can record a resolution, keeping the web app and extension in sync.
 */
function CreateResolution({
  customerId,
  email,
}: {
  customerId: string;
  email: ThreadNegativeEmail;
}): React.ReactElement {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () =>
      getTaskClient().create({
        customerId,
        emailId: email.id,
        title: email.subject || 'Negative sentiment email',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'by-email', customerId, email.id] });
    },
  });

  return (
    <div className="space-y-1">
      <button
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
      >
        {createMutation.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <AlertTriangle size={12} />
        )}
        Open escalation to resolve
      </button>
      {createMutation.error && (
        <p className="text-xs text-destructive">{(createMutation.error as Error).message}</p>
      )}
    </div>
  );
}
