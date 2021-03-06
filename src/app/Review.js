import React, { Component } from "react";
import { Link } from "react-router-dom";
import cx from "classnames";
import marked from "marked";
import Chance from "chance";
import { ResponsiveContainer, Cell, PieChart, Pie, Tooltip, Legend, Label } from "recharts";

import config from "../config";
import Octicon from "../components/Octicon";
import ProgressBar from "../components/ProgressBar";
import * as api from "./apiActions";
import * as analytics from "../components/GoogleAnalytics";
import "./Review.css";

const chance = new Chance();
const PAGE_SIZE = 12;
const SELF_GRADE_CORRECT = "I was right";
const SELF_GRADE_INCORRECT = "I was wrong";

const initialState = {
  deck: {},
  cards: [],
  options: [],
  index: 0,
  isWrong: false,
  isLoading: true,
  isError: false,
  isReversed: false,
  isFinished: false,
  isRevealed: false,
  numCorrect: 0,
  numIncorrect: 0,
  selected: {},
  page: 0,
};

class Review extends Component {
  state = { ...initialState };

  componentWillMount() {
    const { params } = this.props.match;
    this.fetchDeck(params.deckId);
  }

  componentDidMount() {
    window.addEventListener("keyup", e => this.onKeyPress(e));
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", e => this.onKeyPress(e));
    clearTimeout(this.timeout);
  }

  onSelect = (answer, card) => {
    if (this.isSelfGraded()) {
      if (this.state.isRevealed) {
        this.setState({ selected: answer });
        analytics.logReviewEvent(card.id);
        if (answer === SELF_GRADE_INCORRECT) {
          this.setState({
            numCorrect: this.state.numCorrect - 1,
            numIncorrect: this.state.numIncorrect + 1,
          });
        }
        this.timeout = setTimeout(() => {
          this.onCorrectAnswer();
          this.onToggleReveal();
        }, 300);
      }
    } else if (this.isCorrect(answer, card)) {
      this.setState({ selected: answer });
      analytics.logReviewEvent(card.id);
      this.timeout = setTimeout(() => this.onCorrectAnswer(), 300);
    } else {
      this.setState({ selected: answer });
      this.onIncorrectAnswer(card);
    }
  };

  onKeyPress = e => {
    if (this.isFinished() && e.keyCode === 32) {
      this.onKeepGoing();
    } else if (!this.isFinished()) {
      const { options } = this.state;
      if (options.map((i, k) => String(k + 1)).includes(e.key)) {
        const answer = parseInt(e.key, 10) - 1;
        const { options } = this.state;
        const currentCard = this.getCurrentCard();
        this.onSelect(options[answer], currentCard);
      } else if (this.isSelfGraded() && !this.state.isRevealed) {
        if (e.keyCode === 32) {
          this.onToggleReveal();
        }
      }
    }
  };

  onCorrectAnswer = () => {
    const { cards } = this.state;
    const index = Math.min(this.state.index + 1, cards.length);
    const isReversed = this.isReversible(this.state.deck) && chance.bool();
    const options = this.getOptions(index, cards);
    const numCorrect = this.state.numCorrect + 1;
    if (this.isFinished(index)) {
      if (this.state.index <= this.state.cards.length - 1) {
        analytics.logCompletedEvent(this.state.deck.id);
      } else {
        analytics.logFinishedEvent(this.state.deck.id);
      }
      localStorage.setItem(this.state.deck.id, this.getProgress(index) / 100);
    }
    this.setState({
      index,
      options,
      isReversed,
      numCorrect,
      selected: {},
    });
  };

  onIncorrectAnswer = card => {
    const numIncorrect = this.state.numIncorrect + 1;
    this.setState({ isWrong: true, numIncorrect }, () =>
      setTimeout(() => this.setState({ isWrong: false }), 500),
    );
  };

  onToggleReveal = () => {
    this.setState({ isRevealed: !this.state.isRevealed }, () =>
      this.setState({
        options: this.getOptions(this.state.index, this.state.cards),
      }),
    );
  };

  onReset = () => {
    const { deck } = this.state;
    analytics.logReviewAgainEvent(deck.id);

    this.setState({ ...initialState, deck }, () => {
      this.fetchCards(deck);
      localStorage.setItem(this.state.deck.id, this.getProgress() / 100);
    });
  };

  onKeepGoing = () => {
    analytics.logReviewAgainEvent(this.state.deck.id);
    this.setState({ page: this.state.page + 1 });
  };

  fetchDeck = deckId => {
    api.fetchDeck(deckId).then(
      response => {
        this.setState({ deck: response }, () => this.fetchCards(response));
      },
      error => this.setState({ isError: true, isLoading: false }),
    );
  };

  fetchCards = deck => {
    const { index } = this.state;
    api.fetchCards(deck).then(
      response => {
        const cards = chance.shuffle(response);
        const options = this.getOptions(index, cards);
        this.setState({ cards, options, isLoading: false });
      },
      error => this.setState({ isError: true, isLoading: false }),
    );
  };

  getOptions = (index, cards) => {
    if (this.isSelfGraded()) {
      return [SELF_GRADE_CORRECT, SELF_GRADE_INCORRECT];
    } else if (this.isMultiple()) {
      return [...new Set(cards.map(el => el.back))].map((el, i) => ({ id: i, back: el }));
    } else {
      const random = chance.unique(chance.natural, Math.min(3, cards.length), {
        min: 0,
        max: cards.length - 1,
      });
      const uniqOptions = [...new Set([...random, index])];
      const opts = chance.shuffle(uniqOptions);
      return opts.map(el => cards[el]);
    }
  };

  getDeckType = () => (this.isSelfGraded() ? "Self graded" : "Multiple choice");
  getCurrentCard = () => this.state.cards[this.state.index];
  getCategoryUrl = id => `/categories/${id}`;
  getOptionHTML = option => marked(this.state.isReversed ? option.front : option.back || option);
  getCardHTML = card => marked(this.state.isReversed ? card.back : card.front);

  getProgress = index => Math.round(100 * (index || this.state.index) / this.state.cards.length);
  getPageStart = () => Math.max(Math.floor(this.state.page * PAGE_SIZE), 0);
  getPageEnd = () =>
    Math.min(Math.floor((this.state.page + 1) * PAGE_SIZE), this.state.cards.length);

  getResults = () => [
    { name: "Correct", value: this.state.numCorrect },
    { name: "Incorrect", value: this.state.numIncorrect },
  ];
  getProgressData = () => [
    { name: "Seen", value: this.state.index },
    { name: "New", value: this.state.cards.length - this.state.index },
  ];

  isReversible = deck => (deck || this.state.deck).type === "Reversible select";
  isMultiple = deck => (deck || this.state.deck).type === "Multiple select";
  isSelfGraded = deck => (deck || this.state.deck).type === "Self graded";
  isImageSelect = deck => (deck || this.state.deck).type === "Image select";
  isFinished = index =>
    (index || this.state.index) >= Math.min(this.getPageEnd(), this.state.cards.length);
  isCorrect = (option, card) =>
    this.isMultiple() ? option.back === card.back : option.id === card.id || this.isSelfGraded();
  isSelected = option =>
    option.id ? this.state.selected.id === option.id : this.state.selected === option;

  render() {
    const { deck, options, index, isLoading, isError } = this.state;

    if (isLoading) {
      return (
        <div className="container p-4">
          <h1 className="text-secondary">Loading deck...</h1>
        </div>
      );
    }

    if (isError) {
      return (
        <div className="container p-4">
          <Link to="/" className="text-dark d-flex align-items-center mb-2">
            <Octicon name="chevron-left" className="d-flex mr-1" />
            Back to Home
          </Link>
          <div className="text-center">
            <h1 className="text-dark">Unable to load request</h1>
            <p>Please try again or go back home.</p>
          </div>
        </div>
      );
    }

    const currentCard = this.getCurrentCard();
    const progressData = this.getProgressData();
    const progress = this.getProgress();
    const pageEnd = this.getPageEnd();
    const isFinished = this.isFinished();

    return (
      <div className="container py-4 px-3">
        <div className="mb-5">
          <Link
            to={this.getCategoryUrl(deck.category)}
            className="text-dark d-flex align-items-center mb-2"
          >
            <Octicon name="chevron-left" className="d-flex mr-1" />
            Back to Category
          </Link>
          <h1 className="m-0">{deck.name}</h1>
          {deck.description && (
            <div
              className="deck-description mb-2"
              dangerouslySetInnerHTML={{
                __html: marked(deck.description),
              }}
            />
          )}
          {deck.source && (
            <div className="mb-2">
              <a href={deck.source}>{deck.source}</a>
            </div>
          )}
        </div>
        <div className="row mt-5 pt-4 px-3">
          <span
            className="small text-secondary text-right w-100 mb-1 mr-1"
            style={{ opacity: 0.5 }}
          >
            {index} / {pageEnd}
          </span>
          <ProgressBar className="mb-3" value={index} total={pageEnd} />
          <div
            style={{ minHeight: "400px" }}
            className={cx(
              "col-12 border border-dark rounded mb-4 py-5 d-flex align-items-stretch",
              {
                shake: this.state.isWrong,
              },
            )}
          >
            {!isFinished ? (
              <div className="row w-100 mx-0">
                {deck.type && (
                  <div
                    className="badge badge-pill badge-light text-secondary position-absolute mr-4"
                    style={{ top: "12px", right: "0" }}
                  >
                    {this.getDeckType()}
                  </div>
                )}
                <div className="col-12 col-lg-6 d-flex align-items-center px-1 pb-1">
                  {this.isImageSelect(deck) ? (
                    <img className="img-fluid px-3 mx-auto" alt="" src={currentCard.front} />
                  ) : (
                    <div className="flashcard-body border rounded px-3 py-5 w-100 h-100">
                      <div
                        className="markdown-body text-left d-flex align-items-center justify-content-center flex-column"
                        dangerouslySetInnerHTML={{
                          __html: this.getCardHTML(currentCard),
                        }}
                      />
                      {this.state.isRevealed && (
                        <div
                          className="markdown-body text-left d-flex align-items-center justify-content-center flex-column mt-3 pt-3"
                          style={{ borderTop: "1px solid #f5f5f5" }}
                          dangerouslySetInnerHTML={{
                            __html: marked(currentCard.back),
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="col-12 col-lg-6 d-flex flex-column align-items-stretch px-1 pb-1">
                  {options.map((option, key) => (
                    <div
                      key={option.id || option}
                      onClick={() => this.onSelect(option, currentCard)}
                      className={cx(
                        "flashcard-option border rounded d-flex align-items-start p-3 w-100",
                        {
                          "flashcard-option--disabled":
                            this.isSelfGraded() && !this.state.isRevealed,
                          "border-success text-success":
                            this.isSelected(option) && this.isCorrect(option, currentCard),
                          "border-danger text-danger":
                            this.isSelected(option) && !this.isCorrect(option, currentCard),
                        },
                      )}
                    >
                      <div className="border rounded mr-3 px-2" style={{ fontSize: ".9em" }}>
                        {key + 1}
                      </div>
                      <div
                        className="markdown-body text-left bg-white w-100"
                        dangerouslySetInnerHTML={{
                          __html: this.getOptionHTML(option),
                        }}
                      />
                    </div>
                  ))}
                  {this.isSelfGraded() &&
                    !this.state.isRevealed && (
                      <button className="btn border rounded mt-2" onClick={this.onToggleReveal}>
                        Press space to show answer
                      </button>
                    )}
                </div>
                <a
                  href={config.airtableReportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-reset position-absolute d-flex align-items-center"
                  style={{ right: 0, bottom: 0, fill: "#cdcdcd", color: "#cdcdcd" }}
                >
                  <small>Report</small>
                  <Octicon name="report" className="d-flex ml-1" />
                </a>
              </div>
            ) : (
              <div className="w-100">
                <h3 className="mb-5 text-center">
                  {this.state.index <= this.state.cards.length - 1 ? "Nice work!" : "You're done!"}
                </h3>
                <div className="row d-flex mb-2">
                  <div className="px-5 position-relative col-12 col-lg-6">
                    <ResponsiveContainer height={200} width="100%">
                      <PieChart>
                        <Pie
                          data={progressData}
                          dataKey="value"
                          innerRadius={60}
                          outerRadius={80}
                          animationDuration={0}
                          startAngle={180}
                          endAngle={0}
                          fill="#82ca9d"
                        >
                          <Cell fill="#343a40" />
                          <Cell fill="#efefef" />
                          <Label
                            className="font-weight-bold"
                            fill="#343a40"
                            position="center"
                            style={{ fontSize: "24px" }}
                            value={`${progress}%`}
                          />
                        </Pie>
                        <Legend className="w-100" verticalAlign="top" height={50} />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <span
                      className="text-center font-weight-medium position-absolute"
                      style={{ right: 0, left: 0, top: "135px" }}
                    >
                      Progress
                    </span>
                  </div>
                  <div className="px-4" style={{ flexGrow: 1 }}>
                    <table className="table w-100">
                      <thead>
                        <tr>
                          <th>Results</th>
                          <th>#</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Incorrect Answers</td>
                          <td>{this.state.numIncorrect}</td>
                        </tr>
                        <tr>
                          <td>Correct Answers</td>
                          <td>{this.state.numCorrect}</td>
                        </tr>
                        <tr>
                          <td>Total Seen</td>
                          <td>{this.state.index}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="d-flex justify-content-center">
                  {this.state.index <= this.state.cards.length - 1 ? (
                    <button className="btn btn-dark" onClick={this.onKeepGoing}>
                      Press space to continue
                    </button>
                  ) : (
                    <button className="btn btn-dark" onClick={this.onReset}>
                      Try again
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default Review;
