const path = require('path')
const dns = require('dns')
const getPort = require('get-port')
const Docker = require('dockerode')
const fsx = require('fs-extra')
const tar = require('tar-fs')
const request = require('request')
const ip = require('ip')
const docker = new Docker()
const { expect, assert } = require('chai')
const { progressFollower, progressToLogLines } = require('./progressListener')

describe('basic networking', function () {
  const selfName = 'localhost'

  before(function () {
    this.timeout(50 * 1000)
    const tarred = tar.pack(path.resolve(__dirname, '../src'))
    return docker.buildImage(tarred, { t: 'my-image' })
    .then((stream) => progressToLogLines(stream, (line) => progressFollower(undefined, line)))
  })

  it('runs a container, can make request to it', function () {
    this.timeout(20 * 1000)
    const oneMsInNs = 1000000
    const oneSInNs = 1000 * oneMsInNs
    // const fiveSinNs = 5 * oneSInNs
    const containerName = 'my-test'
    let port
    return getPort()
    .then((p) => port = p)
    .then(() => docker.createContainer({
      name: containerName,
      Image: 'my-image',
      Detach: true,
      Tty: true,
      Healthcheck: {
        Test: [
          'CMD-SHELL',
          `curl --silent --fail http://${selfName}:5000/file.txt || exit 1`
        ],
        Interval: oneSInNs,
        Timeout: oneSInNs,
        Retries: 12,
        StartPeriod: oneSInNs
      },
      HostConfig: {
        PortBindings: { '5000/tcp': [ { HostPort: port.toString() } ] }
      },
    }))
    .then(() => {
      const ct = docker.getContainer(containerName)
      return new Promise((res, rej) => {
        docker.getEvents({
          container: 'my-test',
          filters: {
            'event': [ 'health_status' ]
          }
        }, (err, stream) => {
          if (err) {
            rej(err)
          }
          else {
            stream.once('data', (evt) => {
              const status = JSON.parse(evt.toString()).status
              if (status.match(/healthy/)) {
                request(`http://${selfName}:${port.toString()}/file.txt`, { timeout: 1000 }, (err, resp, body) => {
                  err ? rej(err) : res(body)
                })
              }
            })
          }
        })
        ct.start()
      })
      .then(
        (resp) => ct.kill().then(() => ct.remove()).then(() => resp),
        (err) => ct.kill().then(() => ct.remove()).then(() => { throw(err) })
      )
    })
    .then(
      response => expect(response).to.match(/hello world/),
      err => assert(false, err.toString())
    )
  })
})
