import { useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../api/axios.js';
import { addDays, formatDate, getCurrentWeekStart } from '../utils/calendar.js';

const dayNames = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'];

export default function SchedulePage({ user, onLogout, onSessionExpired }) {
  const [slots, setSlots] = useState([]);
  const [weekStart, setWeekStart] = useState(getCurrentWeekStart);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryNumber, setRetryNumber] = useState(0);
  const [bookingStates, setBookingStates] = useState({});
  const [bookings, setBookings] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [participantsBySlot, setParticipantsBySlot] = useState({});
  const [participantsLoading, setParticipantsLoading] = useState(true);
  const [participantsError, setParticipantsError] = useState('');
  const [participantsRetryNumber, setParticipantsRetryNumber] = useState(0);
  // A ref updates immediately, so rapid clicks cannot send duplicate requests.
  const pendingBookings = useRef(new Map());

  useEffect(() => {
    const requests = pendingBookings.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
    };
  }, []);

  async function handleBookingAction(slot) {
    if (pendingBookings.current.has(slot.id)) return;

    const currentBooking = bookings.find((booking) => booking.slotId === slot.id);
    const controller = new AbortController();
    pendingBookings.current.set(slot.id, controller);
    setBookingStates((states) => ({ ...states, [slot.id]: { loading: true } }));

    try {
      if (currentBooking) {
        await api.delete(`/bookings/${currentBooking.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setBookings((items) => items.filter((booking) => booking.id !== currentBooking.id));
        setParticipantsBySlot((items) => ({
          ...items,
          [slot.id]: (items[slot.id] || []).filter((booking) => booking.user.id !== user.id),
        }));
      } else {
        const response = await api.post('/bookings', { slotId: slot.id }, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setBookings((items) => [...items.filter((booking) => booking.slotId !== slot.id), response.data]);
        setParticipantsBySlot((items) => ({
          ...items,
          [slot.id]: [
            ...(items[slot.id] || []).filter((booking) => booking.user.id !== user.id),
            { id: response.data.id, user: { id: user.id, name: user.name } },
          ],
        }));
      }
      // Update our own name immediately, then read all participants from the server.
      setParticipantsRetryNumber((number) => number + 1);
      setSelectedSlotId((id) => id === slot.id ? null : id);
      setBookingStates((states) => ({
        ...states,
        [slot.id]: { loading: false, type: 'success',
          message: currentBooking ? 'Đã hủy booking.' : 'Booking thành công.' },
      }));
    } catch (requestError) {
      if (controller.signal.aborted) return;
      const status = requestError.response?.status;
      if (status === 401) {
        onSessionExpired();
        return;
      }
      // Another tab may have changed this user's booking. Read the real state again.
      if (status === 409 && !currentBooking) {
        setParticipantsRetryNumber((number) => number + 1);
        try {
          const response = await api.get('/bookings/me', { signal: controller.signal });
          if (controller.signal.aborted) return;
          const savedBooking = response.data.find((booking) => booking.slotId === slot.id);
          setBookings((items) => [
            ...items.filter((booking) => booking.slotId !== slot.id),
            ...(savedBooking ? [savedBooking] : []),
          ]);
          setSelectedSlotId((id) => id === slot.id ? null : id);
        } catch (syncError) {
          if (controller.signal.aborted) return;
          if (syncError.response?.status === 401) {
            onSessionExpired();
            return;
          }
        }
      }
      if (status === 404 && currentBooking) {
        setBookings((items) => items.filter((booking) => booking.id !== currentBooking.id));
        setSelectedSlotId((id) => id === slot.id ? null : id);
        setParticipantsBySlot((items) => ({
          ...items,
          [slot.id]: (items[slot.id] || []).filter((booking) => booking.user.id !== user.id),
        }));
        setParticipantsRetryNumber((number) => number + 1);
      }
      const message = status === 409
        ? 'Bạn đã đặt khung giờ này rồi.'
        : status === 404
          ? currentBooking ? 'Booking này không còn tồn tại.' : 'Khung giờ này không còn tồn tại. Vui lòng tải lại trang.'
          : currentBooking ? 'Không thể hủy booking. Vui lòng thử lại.' : 'Không thể đặt khung giờ. Vui lòng thử lại.';
      setBookingStates((states) => ({
        ...states, [slot.id]: { loading: false, type: 'error', message },
      }));
    } finally {
      pendingBookings.current.delete(slot.id);
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadSchedule() {
      setLoading(true);
      setError('');
      try {
        const [slotsResponse, bookingsResponse] = await Promise.all([
          api.get('/slots', { signal: controller.signal }),
          api.get('/bookings/me', { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) {
          setSlots(slotsResponse.data);
          setBookings(bookingsResponse.data);
        }
      } catch (requestError) {
        if (controller.signal.aborted) return;
        if (requestError.response?.status === 401) {
          onSessionExpired();
          return;
        }
        setError(getErrorMessage(requestError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadSchedule();
    return () => controller.abort();
  }, [retryNumber]);

  // Participant failures have separate feedback so the calendar stays usable.
  useEffect(() => {
    const controller = new AbortController();

    async function loadParticipants() {
      setParticipantsLoading(true);
      setParticipantsError('');
      try {
        const response = await api.get('/schedule', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const bySlot = {};
        for (const slot of response.data) bySlot[slot.id] = slot.bookings;
        setParticipantsBySlot(bySlot);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        if (requestError.response?.status === 401) {
          onSessionExpired();
          return;
        }
        setParticipantsError('Không thể tải danh sách người tham gia. Vui lòng thử lại.');
      } finally {
        if (!controller.signal.aborted) setParticipantsLoading(false);
      }
    }

    loadParticipants();
    return () => controller.abort();
  }, [participantsRetryNumber]);

  // Group the server's slots by date, without inventing any time slots.
  const slotsByDate = {};
  for (const slot of slots) {
    if (!slotsByDate[slot.date]) slotsByDate[slot.date] = [];
    slotsByDate[slot.date].push(slot);
  }

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const hasSlotsThisWeek = days.some((date) => slotsByDate[date]?.length > 0);
  const bookingsBySlot = {};
  for (const booking of bookings) bookingsBySlot[booking.slotId] = booking;

  return (
    <section className="schedule" aria-labelledby="schedule-title">
      <div className="schedule-heading">
        <div>
          <p className="eyebrow">Overange / Casting schedule</p>
          <h1 id="schedule-title">Weekly casting schedule</h1>
          <p className="intro">Chọn khung giờ, xác nhận Booking và xem những người cùng tham gia.</p>
        </div>
      </div>

      <div className="week-toolbar">
        <h2 className="week-range" aria-live="polite">
          {formatDate(weekStart, true)} – {formatDate(days[6], true)}
        </h2>
        <nav className="week-navigation" aria-label="Chọn tuần">
          <button className="secondary-button" type="button"
            onClick={() => setWeekStart((date) => addDays(date, -7))}><span aria-hidden="true">← </span>Tuần trước</button>
          <button className="secondary-button" type="button"
            onClick={() => setWeekStart(getCurrentWeekStart())}>Tuần hiện tại</button>
          <button className="secondary-button" type="button"
            onClick={() => setWeekStart((date) => addDays(date, 7))}>Tuần sau<span aria-hidden="true"> →</span></button>
        </nav>
      </div>

      {participantsError && (
        <div className="participants-error">
          <p className="message error" role="alert">{participantsError}</p>
          <button className="secondary-button" type="button" disabled={participantsLoading}
            onClick={() => setParticipantsRetryNumber((number) => number + 1)}>Thử lại danh sách</button>
        </div>
      )}

      {loading ? (
        <p className="message" role="status">Đang tải lịch và booking...</p>
      ) : error ? (
        <div>
          <p className="message error" role="alert">{error}</p>
          <button type="button" onClick={() => setRetryNumber((number) => number + 1)}>Thử lại</button>
        </div>
      ) : (
        <>
          {!hasSlotsThisWeek && (
            <p className="message empty-week" role="status">Tuần này chưa có khung giờ.</p>
          )}
          <div className="calendar-grid">
            {days.map((date, index) => (
              <section className="day-card" key={date} aria-labelledby={`day-${date}`}>
                <h3 id={`day-${date}`}>
                  <span>{dayNames[index]}</span>
                  <time dateTime={date}>{formatDate(date)}</time>
                </h3>
                {slotsByDate[date]?.length ? (
                  <ul className="slot-list">
                    {slotsByDate[date].map((slot) => (
                      <li className="slot-item" key={slot.id}>
                        <button className={`time-slot ${bookingsBySlot[slot.id] ? 'booked-slot' : ''}`} type="button"
                          aria-label={`Khung giờ ${slot.startTime} – ${slot.endTime}, ngày ${formatDate(slot.date, true)}`}
                          aria-pressed={selectedSlotId === slot.id}
                          aria-busy={bookingStates[slot.id]?.loading || false}
                          disabled={bookingStates[slot.id]?.loading || false}
                          onClick={() => setSelectedSlotId((id) => id === slot.id ? null : slot.id)}>
                          <time dateTime={slot.startTime}>{slot.startTime}</time>
                          {' – '}
                          <time dateTime={slot.endTime}>{slot.endTime}</time>
                          {bookingsBySlot[slot.id] && <span className="booking-badge">✓ Đã booking</span>}
                          {bookingStates[slot.id]?.loading && (
                            <span className="slot-loading">{bookingsBySlot[slot.id] ? 'Đang hủy...' : 'Đang booking...'}</span>
                          )}
                        </button>
                        {selectedSlotId === slot.id && (
                          <button className={`slot-action ${bookingsBySlot[slot.id] ? 'cancel-action' : ''}`}
                            type="button" disabled={bookingStates[slot.id]?.loading || false}
                            onClick={() => handleBookingAction(slot)}>
                            {bookingStates[slot.id]?.loading
                              ? bookingsBySlot[slot.id] ? 'Đang hủy...' : 'Đang booking...'
                              : bookingsBySlot[slot.id] ? 'Hủy booking' : 'Booking'}
                          </button>
                        )}
                        {bookingStates[slot.id]?.message && (
                          <p className={`slot-feedback ${bookingStates[slot.id].type}`}
                            role={bookingStates[slot.id].type === 'error' ? 'alert' : 'status'}>
                            {bookingStates[slot.id].message}
                          </p>
                        )}
                        <div className="participants">
                          {participantsBySlot[slot.id]?.length ? (
                            <>
                              <p className="participants-title">Participants</p>
                              <ul className="participants-list">
                                {participantsBySlot[slot.id].map((booking) => (
                                  <li key={booking.id}>
                                    {booking.user.name}{booking.user.id === user.id ? ' (Bạn)' : ''}
                                  </li>
                                ))}
                              </ul>
                            </>
                          ) : participantsBySlot[slot.id] ? (
                            <p className="participants-note">Chưa có người tham gia</p>
                          ) : (
                            <p className="participants-note" role="status">
                              {participantsLoading ? 'Đang tải người tham gia...' : 'Danh sách chưa tải được.'}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="empty-day">Không có khung giờ.</p>}
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
