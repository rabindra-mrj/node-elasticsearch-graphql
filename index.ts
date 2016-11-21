import {makeExecutableSchema} from 'graphql-tools';
import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';

var schema = `
type Author {
  id: Int! # the ! means that every author object _must_ have an id
  firstName: String
  lastName: String
  posts: [Post] # the list of Posts by this author
}

type Post {
  id: Int!
  title: String
  author: Author
  votes: Int
}

# the schema allows the following query:
type Query {
  posts: [Post]
}

# we need to tell the server which types represent the root query
# and root mutation types. We call them RootQuery and RootMutation by convention.
schema {
  query: Query
}
`;

const resolveFunctions = {
  Query: {
    posts() {
      return [{id : 1, title : "post 1", author: {id: 1, firstName: "author1"}}];
    },
  },
  Author: {
    posts(author) {
      return {id : 1, title : "post 1", author: {id: 1, firstName: "author1"}};
    },
  },
  Post: {
    author(post) {
      return {id: 1, firstName: "author1"};
    },
  },
};

const executableSchema = makeExecutableSchema({
  typeDefs: schema,
  resolvers: resolveFunctions,
});


const app = express();
 app.use('/graphql', graphqlHTTP({
    schema: executableSchema,
    graphiql: true,
  }));
app.listen(4000, () => console.log('Now browse to localhost:4000/graphql'));