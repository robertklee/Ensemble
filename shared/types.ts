export const CATEGORIES = [
  'food',
  'lodging',
  'transport',
  'activity',
  'shopping',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const METHODS = ['cash', 'bank_transfer', 'paypal', 'venmo', 'other'] as const;
export type PaymentMethod = (typeof METHODS)[number];
export type SplitMethod = 'even' | 'shares' | 'exact';
export type TripStatus = 'active' | 'settling' | 'closed';
export interface User {
  id: string;
  username: string;
  displayName: string;
  defaultCurrency: string;
}
export interface Member {
  id: string;
  name: string;
  isGhost: boolean;
  role: 'organizer' | 'member';
  left?: boolean;
}
export interface Trip {
  id: string;
  name: string;
  description: string;
  baseCurrency: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  createdBy: string;
  createdAt: string;
  members: Member[];
  deletedAt?: string;
}
export type TripPatch = Partial<Pick<Trip, 'name' | 'description'>> & {
  dates?: Pick<Trip, 'startDate' | 'endDate'>;
};
export interface Payer {
  userId: string;
  amountPaid: number;
}
export interface Split {
  userId: string;
  owedAmount: number;
  shareWeight?: string;
  rawInput?: number;
}
export interface Ledger {
  amount: number;
  currency: string;
  fxRate: string;
  payers: Payer[];
  splitMethod: SplitMethod;
  splits: Split[];
}
export interface Expense extends Ledger {
  id: string;
  description: string;
  category: Category;
  date: string;
  notes: string;
  attachments: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
export interface Settlement {
  id: string;
  fromUser: string;
  toUser: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  note: string;
  createdAt: string;
}
export type ExpensePatch = Partial<
  Pick<Expense, 'description' | 'category' | 'date' | 'notes' | 'attachments'>
> & { ledger?: Ledger };
export type EventData =
  | { kind: 'trip.create'; trip: Trip }
  | { kind: 'trip.edit'; patch: TripPatch }
  | { kind: 'trip.status'; status: TripStatus }
  | { kind: 'trip.delete' }
  | { kind: 'member.add'; member: Member }
  | { kind: 'member.rename'; name: string }
  | { kind: 'member.leave'; userId: string }
  | { kind: 'member.claim'; ghostId: string; user: User }
  | { kind: 'expense.add'; expense: Expense }
  | { kind: 'expense.edit'; expenseId: string; patch: ExpensePatch }
  | { kind: 'expense.delete'; expenseId: string }
  | { kind: 'expense.restore'; expenseId: string }
  | { kind: 'expense.comment'; expenseId: string; text: string }
  | { kind: 'settlement.add'; settlement: Settlement };
export type TripEvent = EventData & {
  id: string;
  tripId: string;
  actor: string;
  origin: string;
  updatedAt: string;
};
export interface Comment {
  id: string;
  expenseId: string;
  actor: string;
  text: string;
  createdAt: string;
}
export interface TripState {
  trip: Trip;
  expenses: Expense[];
  settlements: Settlement[];
  comments: Comment[];
  events: TripEvent[];
}
export interface Balance {
  userId: string;
  paid: number;
  owed: number;
  net: number;
}
export interface Transfer {
  fromUser: string;
  toUser: string;
  amount: number;
}
export interface Friend {
  id: string;
  user: User;
  status: 'pending' | 'accepted' | 'blocked';
  incoming: boolean;
}
export interface Notice {
  id: string;
  tripId: string;
  message: string;
  createdAt: string;
  read: boolean;
}
